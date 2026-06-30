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

## Installation

```bash
npm install @longsightgroup/lti-tool
```

## Quick Start

```typescript
import { LTITool } from '@longsightgroup/lti-tool';
import { MemoryStorage } from '@longsightgroup/lti-tool/storage/memory';

const ltiTool = new LTITool({
  stateSecret: new TextEncoder().encode('your-secret-key'),
  keyPair, // Your RSA keypair
  storage: new MemoryStorage(),
});

await ltiTool.upsertLaunchRegistration({
  name: 'Moodle Sandbox',
  iss: 'https://sandbox.moodledemo.net',
  clientId: 'your-client-id',
  deploymentId: 'your-deployment-id',
  authUrl: 'https://sandbox.moodledemo.net/mod/lti/auth.php',
  tokenUrl: 'https://sandbox.moodledemo.net/mod/lti/token.php',
  jwksUrl: 'https://sandbox.moodledemo.net/mod/lti/certs.php',
});

const authUrl = await ltiTool.handleLogin(loginParams);

const result = await ltiTool.verifyLaunchDetailed(idToken, state);
if (result.success) {
  const session = await ltiTool.createSessionFromVerifiedLaunch(result.launch);
}
```

Use `upsertLaunchRegistration` whenever an LMS administrator gives you issuer, client ID, deployment ID, and OIDC endpoints. For self-service registration, use dynamic registration instead.

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

- [API Reference](https://docs.lti-tool.dev) - Complete API documentation
- [Examples](https://github.com/lti-tool/lti-tool-examples) - (Coming soon) Working examples

## Security

Production security features

- JWT signature verification using platform JWKS
- Nonce validation prevents replay attacks
- State verification prevents CSRF
- Client ID and deployment validation
