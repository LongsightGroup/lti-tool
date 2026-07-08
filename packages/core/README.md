# lti-tool core

<p align="center">
  <a href="https://www.npmjs.com/package/@longsightgroup/lti-tool"><img alt="npm" src="https://img.shields.io/npm/dm/%40lti-tool%2Fcore?style=flat-square" /></a>
  <a href="https://github.com/lti-tool/lti-tool/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/lti-tool/lti-tool/ci.yml?style=flat-square&branch=dev" /></a>
</p>
<p align="center">Modern LTI 1.3 toolkit, built for TypeScript.</p>

## Core Features

- **LTI 1.3 OIDC Flow** - Complete authentication and launch verification
- **Security** - JWT verification, nonce validation, replay attack prevention
- **Assignment and Grade Services (AGS)** - Score submission to LMS
- **Session Management** - Secure session creation and retrieval
- **Platform registration** - One-call launch registration via `upsertLaunchRegistration`
- **Small app ports** - `LtiToolPort`, `LtiAdvantagePort`, and service-specific client interfaces for app modules and tests

## Installation

```bash
npm install @longsightgroup/lti-tool
```

## Quick Start

```typescript
import { LTITool, upsertLaunchRegistration } from '@longsightgroup/lti-tool';
import { MemoryStorage } from '@longsightgroup/lti-tool/storage/memory';

const storage = new MemoryStorage();
const ltiTool = new LTITool({
  stateSecret: new TextEncoder().encode('your-secret-key'),
  keyPair, // Your RSA keypair
  storage,
});

await upsertLaunchRegistration(storage, {
  name: 'Moodle Sandbox',
  iss: 'https://sandbox.moodledemo.net',
  clientId: 'your-client-id',
  deploymentId: 'your-deployment-id',
  authUrl: 'https://sandbox.moodledemo.net/mod/lti/auth.php',
  tokenUrl: 'https://sandbox.moodledemo.net/mod/lti/token.php',
  jwksUrl: 'https://sandbox.moodledemo.net/mod/lti/certs.php',
});

const authUrl = await ltiTool.handleLogin(loginParams);

const result = await ltiTool.verifyLaunch(idToken, state);
if (result.success) {
  const session = await ltiTool.createSessionFromVerifiedLaunch(result.launch);
}
```

Production tools usually load private key material from a secrets manager. Use
`importLtiToolKeyPairFromJwk` when you store the tool key as RSA private JWK JSON:

```typescript
import { importLtiToolKeyPairFromJwk } from '@longsightgroup/lti-tool';

const keyMaterial = await importLtiToolKeyPairFromJwk(privateJwkJson);
const ltiTool = new LTITool({
  stateSecret,
  keyPair: keyMaterial.keyPair,
  storage,
  security: { keyId: keyMaterial.keyId },
});
```

The helper trims an existing `kid` or derives one from the public key thumbprint,
and returns `publicJwk` and `jwks` for custom keyset responses.

Launch verification can emit safe audit events and tune remote JWKS fetch bounds:

```typescript
const ltiTool = new LTITool({
  stateSecret,
  keyPair,
  storage,
  onVerificationEvent: (event) => audit.record(event),
  security: {
    remoteJwks: {
      timeoutDuration: 2_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    },
  },
});
```

For edge runtimes, pass a per-request `onVerificationEvent` to `verifyLaunch` and
schedule asynchronous audit writes with the platform's background-work primitive.

Use `upsertLaunchRegistration` whenever an LMS administrator gives you issuer, client ID, deployment ID, and OIDC endpoints. For self-service registration, use `LtiDynamicRegistration`. Custom admin UIs that manage stored client or deployment records directly should call `LTIStorage` methods instead of `LTITool`.

`LTIStorage.validateNonce` atomically claims nonces during launch verification. Configure
nonce TTL on the storage adapter; core does not pre-store login nonces.

For tests, import builders and fakes from `@longsightgroup/lti-tool/testing`:

```typescript
import {
  createFakeLtiAdvantage,
  testSession,
  testVerifiedLaunch,
} from '@longsightgroup/lti-tool/testing';
```

## Persisted session JSON

Database-backed `LTIStorage` adapters can use the exported codecs to keep JSON
parsing aligned with the core session types:

```typescript
import {
  parsePersistedLtiSession,
  serializeLtiSession,
  type LTIStorage,
} from '@longsightgroup/lti-tool';

class DatabaseStorage implements LTIStorage {
  async getSession(sessionId: string) {
    const row = await db.findSession(sessionId);
    return row === undefined ? undefined : parsePersistedLtiSession(row.dataJson);
  }

  async addSession(session) {
    await db.insertSession({
      id: session.id,
      dataJson: serializeLtiSession(session),
    });
    return session.id;
  }
}
```

## Documentation

- [Examples](https://github.com/lti-tool/lti-tool-examples) - (Coming soon) Working examples

## Security

Production security features

- JWT signature verification using platform JWKS
- Nonce validation prevents replay attacks
- State verification prevents CSRF
- Client ID and deployment validation
