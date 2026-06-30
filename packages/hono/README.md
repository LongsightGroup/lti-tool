# @longsightgroup/lti-tool/hono

<p align="center">Hono middleware for LTI 1.3. Serverless-optimized with automatic route handling.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@longsightgroup/lti-tool"><img alt="npm" src="https://img.shields.io/npm/v/%40longsightgroup%2Flti-tool" /></a>
</p>

## Quick Start

Create a new Hono app

```bash
npm create hono@latest
```

Install the packages

```bash
npm install @longsightgroup/lti-tool hono
npm install @longsightgroup/lti-tool/storage/memory
```

Create a minimal Hono powered LTI tool

```typescript
import { Hono } from 'hono';
import { LTITool } from '@longsightgroup/lti-tool';
import { createLtiRoutes, secureLTISession } from '@longsightgroup/lti-tool/hono';
import { MemoryStorage } from '@longsightgroup/lti-tool/storage/memory';

// Generate keypair (use proper key management in production)
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
  stateSecret: new TextEncoder().encode('your-secret'),
  keyPair,
  storage: new MemoryStorage(),
};

const ltiTool = new LTITool(ltiConfig);

const app = new Hono();

app.route('/lti', createLtiRoutes({ ltiTool }));

app.use('/protected/*', secureLTISession(ltiTool));

app.get('/protected/content', (c) => {
  const session = c.get('ltiSession');
  return c.json({ message: `Hello ${session.user.name}!` });
});
```

## Features

- **createLtiRoutes** — mounts `/jwks`, `/login`, and `/launch` on a Hono sub-app
- **Session Protection** — Middleware for protected routes
- **Type Safety** — Full TypeScript support with Hono context
- **Error Handling** — Structured error responses
- **Serverless Ready** — Optimized for AWS Lambda, Cloudflare Workers

## API Reference

- [API Reference](https://docs.lti-tool.dev/modules/_lti-tool_hono.html) - Complete API documentation

### createLtiRoutes(options)

Mounts required LTI protocol routes (`/jwks`, `/login`, `/launch`) on a Hono sub-app. Pass the same `LTITool` instance you use elsewhere in your app. Optionally pass a `logger` for route-level error logging.

```typescript
import { createLtiRoutes } from '@longsightgroup/lti-tool/hono';

app.route('/lti', createLtiRoutes({ ltiTool, logger }));
```

Mount deep linking and dynamic registration with their explicit route handlers when needed.

### Individual route handlers

Each handler accepts a narrow dependency object (`LtiLoginRouteDeps`, `LtiLaunchRouteDeps`, and so on) for custom paths or tests.

#### loginRouteHandler(deps)

Handles LTI login initiation (OIDC third-party initiated login).

```typescript
import { loginRouteHandler } from '@longsightgroup/lti-tool/hono';

app.post(
  '/lti/login',
  loginRouteHandler({
    handleLogin: (params) => ltiTool.handleLogin(params),
    logger,
  }),
);
```

#### launchRouteHandler(deps)

Handles LTI launch verification and session creation.

```typescript
import { launchRouteHandler } from '@longsightgroup/lti-tool/hono';

app.post(
  '/lti/launch',
  launchRouteHandler({
    verifyLaunchDetailed: (idToken, state) =>
      ltiTool.verifyLaunchDetailed(idToken, state),
    createSessionFromVerifiedLaunch: (launch) =>
      ltiTool.createSessionFromVerifiedLaunch(launch),
    logger,
  }),
);
```

#### jwksRouteHandler(deps)

Serves the JSON Web Key Set (JWKS) for platform verification.

```typescript
import { jwksRouteHandler } from '@longsightgroup/lti-tool/hono';

app.get(
  '/lti/jwks',
  jwksRouteHandler({
    getJWKS: () => ltiTool.getJWKS(),
    logger,
  }),
);
```

### secureLTISession(deps)

Middleware to protect routes with LTI session validation. An `LTITool` instance satisfies the required `getSession` dependency.

```typescript
import { secureLTISession } from '@longsightgroup/lti-tool/hono';

app.use('/protected/*', secureLTISession(ltiTool));

app.get('/protected/grades', (c) => {
  const session = c.get('ltiSession'); // Typed LTISession
  // Handle authenticated request
});
```

## Context Extensions

The middleware extends Hono context with:

```typescript
interface HonoLTIContext {
  ltiSession: LTISession; // Available in protected routes
}
```

## Performance

Optimized for serverless:

- 3-5ms login handling
- 12-15ms launch verification
- Minimal cold start impact
