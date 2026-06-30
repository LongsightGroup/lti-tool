# LTI Tool

A TypeScript library for building [LTI 1.3](https://www.imsglobal.org/spec/lti/v1p3) tools that run on Node.js, Cloudflare Workers, AWS Lambda, and other modern runtimes.

Built on [lti-tool/lti-tool](https://github.com/lti-tool/lti-tool).

[![npm](https://img.shields.io/npm/v/@longsightgroup/lti-tool?style=flat-square)](https://www.npmjs.com/package/@longsightgroup/lti-tool)
[![CI](https://img.shields.io/github/actions/workflow/status/LongsightGroup/lti-tool/ci.yml?style=flat-square)](https://github.com/LongsightGroup/lti-tool/actions/workflows/ci.yml)

## What this is

An LMS (Canvas, Moodle, Sakai, Blackboard, and others) launches your application inside an iframe using LTI 1.3. That launch is an OIDC login flow: the platform redirects the browser to your tool, your tool redirects back to the platform, and the platform posts a signed ID token to your launch endpoint. Your tool verifies that token, learns who the user is and which course they came from, and then serves content.

LTI Tool handles that protocol work so you can focus on your application:

- OIDC third-party login and launch verification
- Session management without relying on third-party cookies
- LTI Advantage services: grades (AGS), rosters (NRPS), deep linking, and dynamic registration
- Pluggable storage for platform configuration, sessions, and nonces
- Optional [Hono](https://hono.dev) route handlers for the standard LTI endpoints

The package ships as a single npm module with subpath exports. Install once, import only what you need.

## Install

```bash
npm install @longsightgroup/lti-tool hono
```

Storage adapters pull in optional peer dependencies (`postgres`, `mysql2`, `@aws-sdk/client-dynamodb`, `drizzle-orm`, and others). Install the backend you actually use.

## Quick start

This example wires up the three endpoints every LTI 1.3 tool needs, registers a Moodle sandbox platform, and protects a route with the launch session.

```typescript
import { Hono } from 'hono';
import { LTITool } from '@longsightgroup/lti-tool';
import {
  jwksRouteHandler,
  launchRouteHandler,
  loginRouteHandler,
  secureLTISession,
} from '@longsightgroup/lti-tool/hono';
import { MemoryStorage } from '@longsightgroup/lti-tool/storage/memory';

const keyPair = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
);

const ltiConfig = {
  stateSecret: new TextEncoder().encode('use-a-random-secret-at-least-32-bytes'),
  keyPair,
  storage: new MemoryStorage(),
};

const ltiTool = new LTITool(ltiConfig);

await ltiTool.upsertLaunchRegistration({
  name: 'Moodle Sandbox',
  iss: 'https://sandbox.moodledemo.net',
  clientId: 'your-client-id',
  deploymentId: 'your-deployment-id',
  jwksUrl: 'https://sandbox.moodledemo.net/mod/lti/certs.php',
  authUrl: 'https://sandbox.moodledemo.net/mod/lti/auth.php',
  tokenUrl: 'https://sandbox.moodledemo.net/mod/lti/token.php',
});

const app = new Hono();

app.get('/lti/jwks', jwksRouteHandler(ltiConfig));
app.get('/lti/login', loginRouteHandler(ltiConfig));
app.post('/lti/login', loginRouteHandler(ltiConfig));
app.post('/lti/launch', launchRouteHandler(ltiConfig));

app.use('/app/*', secureLTISession(ltiConfig));
app.get('/app', (c) => {
  const session = c.get('ltiSession');
  return c.json({ hello: session.user.name, course: session.context?.title });
});
```

After a successful launch, the library redirects the browser to your target URL with an `ltiSessionId` query parameter. Protected routes read that parameter to load the session.

In production, load your RSA key pair and `stateSecret` from a secrets manager instead of generating them at startup. `MemoryStorage` is for development and tests only.

## How a launch works

```mermaid
sequenceDiagram
  participant LMS as LMS (platform)
  participant Browser
  participant Tool as Your tool

  Browser->>Tool: GET /lti/login (iss, client_id, login_hint, ...)
  Tool->>Browser: 302 to LMS authorization endpoint
  Browser->>LMS: Authenticate user
  LMS->>Browser: Auto-post id_token + state to /lti/launch
  Browser->>Tool: POST /lti/launch
  Tool->>Tool: Verify JWT, check nonce, create session
  Tool->>Browser: 302 to /app?ltiSessionId=...
  Browser->>Tool: GET /app?ltiSessionId=...
  Tool->>Browser: Your application response
```

The library verifies the ID token signature against the platform JWKS, validates the OAuth state and nonce, confirms the client ID and deployment ID match your stored configuration, and persists a session you can use for later LTI service calls.

## Core concepts

| Concept           | What it is                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Client**        | A registered LMS platform (issuer URL, OAuth client ID, auth/token/JWKS endpoints).                                                      |
| **Deployment**    | A specific tool installation on that platform, identified by `deployment_id` in the launch.                                              |
| **Launch config** | Cached platform + deployment metadata used on the hot launch path. Created automatically by `upsertLaunchRegistration`.                  |
| **Session**       | The verified launch context: user, roles, course, resource link, and available LTI services. Referenced by `ltiSessionId`.               |
| **Storage**       | Persistence for clients, deployments, sessions, nonces, and dynamic-registration state. Swap adapters without changing application code. |

Register a platform manually with `addClient` and `addDeployment`, or use `upsertLaunchRegistration` to create or update everything from the values your LMS administrator gives you.

## Package exports

Everything installs as `@longsightgroup/lti-tool`. Import subpaths for adapters and framework helpers.

| Import                                        | Purpose                                                      |
| --------------------------------------------- | ------------------------------------------------------------ |
| `@longsightgroup/lti-tool`                    | `LTITool`, schemas, launch verification, LTI service helpers |
| `@longsightgroup/lti-tool/hono`               | Route handlers and session middleware                        |
| `@longsightgroup/lti-tool/storage/memory`     | In-memory storage (dev/test)                                 |
| `@longsightgroup/lti-tool/storage/dynamodb`   | DynamoDB (AWS Lambda, serverless)                            |
| `@longsightgroup/lti-tool/storage/postgresql` | PostgreSQL via Drizzle                                       |
| `@longsightgroup/lti-tool/storage/mysql`      | MySQL via Drizzle                                            |
| `@longsightgroup/lti-tool/storage/d1`         | Cloudflare D1                                                |

Implement the `LTIStorage` interface yourself if you need Redis, another database, or a custom control plane.

## Hono routes

| Route handler                             | Method(s) | Endpoint (convention)                                      |
| ----------------------------------------- | --------- | ---------------------------------------------------------- |
| `jwksRouteHandler`                        | GET       | `/lti/jwks` — your tool's public keys                      |
| `loginRouteHandler`                       | GET, POST | `/lti/login` — OIDC login initiation                       |
| `launchRouteHandler`                      | POST      | `/lti/launch` — ID token verification and session creation |
| `deepLinkRouteHandler`                    | GET       | `/lti/deep-linking` — deep linking content selection UI    |
| `initiateDynamicRegistrationRouteHandler` | GET       | `/lti/register` — start dynamic registration               |
| `completeDynamicRegistrationRouteHandler` | POST      | `/lti/register/complete` — finish dynamic registration     |

`secureLTISession` middleware validates `ltiSessionId` on incoming requests and sets `ltiSession` on the Hono context.

You can also use the core `LTITool` class directly without Hono — call `handleLogin`, `verifyLaunch`, and `createSession` from your own framework.

## LTI Advantage services

Once you have a session, `LTITool` can call platform services on the user's behalf:

- **AGS** — submit scores, manage line items, read results (`submitScore`, `createLineItem`, `getResults`, and related methods)
- **NRPS** — fetch course membership (`getMembers`)
- **Deep linking** — return content items to the platform (`createDeepLinkingResponse`)
- **Dynamic registration** — let administrators register the tool without manual JSON exchange (`initiateDynamicRegistration`, `completeDynamicRegistration`)

Service availability depends on what the platform enabled for the deployment. Helper functions like `isLtiAgsAvailable` and `isLtiNrpsAvailable` inspect the session claims.

## Storage adapters

| Adapter            | Best for                      | Notes                                                  |
| ------------------ | ----------------------------- | ------------------------------------------------------ |
| Memory             | Local development, unit tests | No persistence across restarts                         |
| DynamoDB           | AWS serverless                | Three-table design with TTL for sessions and nonces    |
| PostgreSQL / MySQL | Traditional deployments       | Drizzle schemas and migrations included in the package |
| D1                 | Cloudflare Workers            | SQLite-compatible edge database                        |

Each SQL adapter ships with a `drizzle.config.ts` and generated migration files. The Drizzle schema files are the source of truth; use `npm run db:generate:*` after schema changes and `npm run db:check:migrations` before publishing migration changes. Run Drizzle commands from the monorepo root so the config paths resolve correctly. See the README in `packages/postgresql`, `packages/mysql`, or `packages/d1` for setup commands.

Storage `getLaunchConfig` methods return exact deployment matches only. The core launch flow owns default-deployment resolution.

## Test with Moodle sandbox

[Moodle's public sandbox](https://sandbox.moodledemo.net/) is a free way to exercise a real launch.

1. Log in as administrator (credentials are on the site).
2. Go to **Site administration → Plugins → External tool → Manage tools**.
3. Choose **configure a tool manually** and set:

| Field              | Value                                |
| ------------------ | ------------------------------------ |
| Tool URL           | `https://your-domain.com`            |
| LTI version        | LTI 1.3                              |
| Public key type    | Keyset URL                           |
| Public keyset      | `https://your-domain.com/lti/jwks`   |
| Login URL          | `https://your-domain.com/lti/login`  |
| Redirection URI(s) | `https://your-domain.com/lti/launch` |

4. Enable AGS, NRPS, and deep linking if you want to test those services.
5. After saving, open the tool details (magnifying glass icon) and copy the **Client ID** and **Deployment ID** into `upsertLaunchRegistration`.
6. Add the tool to a course as an **External tool** activity and launch it.

For local development, expose your server with a tunnel (ngrok, Cloudflare Tunnel, etc.) so the sandbox can reach your endpoints.

## Security

- JWT signatures are verified against the platform JWKS.
- OAuth `state` and `nonce` values are validated to prevent CSRF and replay attacks.
- Client ID and deployment ID must match stored configuration.
- Sessions are referenced by ID in the URL, not browser cookies — this works inside LMS iframes where third-party cookies are blocked.

Use a strong, random `stateSecret` (32+ bytes). Store your RSA private key in a secrets manager (AWS KMS, Parameter Store, Vault, etc.). Never commit keys or secrets to source control.

## Documentation and API reference

- [API docs](https://docs.lti-tool.dev)
- [Contributing](CONTRIBUTING.md)
- [Issues](https://github.com/LongsightGroup/lti-tool/issues)
- [Discussions](https://github.com/LongsightGroup/lti-tool/discussions)

## License

MIT
