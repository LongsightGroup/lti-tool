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
- **createLtiOptionalRouteDeps** — binds deps for deep linking and dynamic registration routes
- **Session Protection** — Middleware for protected routes
- **Type Safety** — Full TypeScript support with Hono context
- **Error Handling** — Structured error responses
- **Serverless Ready** — Optimized for AWS Lambda, Cloudflare Workers

## Reference

### createLtiRoutes(options)

Mounts required LTI protocol routes (`/jwks`, `/login`, `/launch`) on a Hono sub-app. Pass the same `LTITool` instance you use elsewhere in your app. Optionally pass a `logger` for route-level error logging; otherwise routes use a noop logger.

```typescript
import { createLtiRoutes } from '@longsightgroup/lti-tool/hono';

app.route(
  '/lti',
  createLtiRoutes({
    ltiTool,
    logger,
    onVerificationEvent: ({ hono, event }) => {
      hono.executionCtx.waitUntil(auditLaunchVerification(event));
    },
  }),
);
```

Mount deep linking and dynamic registration with their explicit route handlers when needed.
Use `onVerificationEvent` to record safe launch verification audit events. In Workers,
schedule asynchronous writes with `waitUntil`.

### customLaunchRouteHandler(options)

Use `customLaunchRouteHandler` when the app owns launch UI but wants the library to
handle protocol parsing, verification, session creation, and launch-message routing.

```typescript
import {
  customLaunchRouteHandler,
  renderDefaultLaunchVerificationFailureResponse,
} from '@longsightgroup/lti-tool/hono';

app.post(
  '/lti/launch',
  customLaunchRouteHandler({
    ltiTool,
    logger,
    authorizeLaunch: (launch) => ({ success: true, data: { tenantId: 'tenant-1' } }),
    onVerifiedLaunch: ({ session }) => auditLaunch(session),
    onVerificationEvent: ({ hono, event }) => {
      hono.executionCtx.waitUntil(auditLaunchVerification(event));
    },
    onVerificationFailure: (context) =>
      context.error.code === 'launch_config_missing_jwks_endpoint'
        ? context.hono.json({ error: 'Platform registration incomplete' }, 501)
        : renderDefaultLaunchVerificationFailureResponse(context),
    renderResourceLink: ({ session, advantage }) => renderBadgePage(session, advantage),
    renderDeepLinkingRequest: ({ message }) => renderContentPicker(message),
    onError: ({ hono }) => hono.json({ error: 'Launch failed' }, 400),
  }),
);
```

The render callbacks receive the Hono context, verified launch, stored session, resolved
launch message, and session-bound Advantage client.
Use `onVerificationFailure` on `customLaunchRouteHandler` when your application needs
custom responses for typed launch verification failures before session creation. Compose
with `renderDefaultLaunchVerificationFailureResponse` to override only selected error
codes. `launchRouteHandler` keeps the built-in default mapping and does not accept this
hook.

### createLtiOptionalRouteDeps(options)

Binds dependency objects for optional routes from `LTITool` and `LtiDynamicRegistration` instances. Pass the same optional `logger` you use with `createLtiRoutes` when you want route-level error logging.

Deep linking response creation is app-owned: call `ltiTool.createAdvantage(session).createDeepLinkingResponse(contentItems)` from your route handler, or `createDeepLinkingHtmlResponse(contentItems)` when your route should return a ready-to-send HTML `Response`.

```typescript
import { LtiDynamicRegistration } from '@longsightgroup/lti-tool';
import {
  completeDynamicRegistrationRouteHandler,
  createLtiOptionalRouteDeps,
  createLtiRoutes,
  deepLinkRouteHandler,
  initiateDynamicRegistrationRouteHandler,
} from '@longsightgroup/lti-tool/hono';

app.route('/lti', createLtiRoutes({ ltiTool, logger }));

const dynamicRegistration = new LtiDynamicRegistration(ltiConfig);
const optionalRoutes = createLtiOptionalRouteDeps({
  ltiTool,
  dynamicRegistration,
  logger,
  getDynamicRegistrationAppState: ({ hono }) => ({
    tenantId: hono.req.query('tenantId') ?? 'default',
  }),
  onRegistrationComplete: async ({ client, deployment, appState }) => {
    await saveTenantRegistration({ client, deployment, appState });
  },
});

app.get('/lti/deep-linking', deepLinkRouteHandler(optionalRoutes.deepLink));
app.get(
  '/lti/register',
  initiateDynamicRegistrationRouteHandler(optionalRoutes.initiateDynamicRegistration),
);
app.post(
  '/lti/register/complete',
  completeDynamicRegistrationRouteHandler(optionalRoutes.completeDynamicRegistration),
);
```

`getDynamicRegistrationAppState` stores JSON-serializable app state in the temporary
registration session. `onRegistrationComplete` runs after core stores the client,
deployment, and launch config, and receives the same `appState` on the completion
result. If the callback throws, the route logs the failure and still returns the
registration success HTML. The LMS registration has already succeeded at that point,
so applications should treat callback failures as requiring reconciliation.

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

Handles LTI launch verification and session creation with the built-in verification-failure
mapping. Use `customLaunchRouteHandler` instead when you need `onVerificationFailure`.

```typescript
import { launchRouteHandler } from '@longsightgroup/lti-tool/hono';

app.post(
  '/lti/launch',
  launchRouteHandler({
    verifyLaunch: (idToken, state) => ltiTool.verifyLaunch(idToken, state),
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
