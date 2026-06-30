import { LTITool } from '@longsightgroup/lti-tool';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MemoryStorage } from '../../memory/src/index.js';
import { createLtiRoutes } from '../src/ltiRoutes/createLtiRoutes.js';

function mountLtiRoutes(ltiTool: LTITool) {
  const app = new Hono();
  app.route('/lti', createLtiRoutes({ ltiTool }));
  return app;
}

describe('createLtiRoutes', () => {
  let keyPair: CryptoKeyPair;
  let ltiTool: LTITool;

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
  });

  beforeEach(() => {
    ltiTool = new LTITool({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage: new MemoryStorage(),
    });
  });

  it('mounts required protocol routes on the sub-app', async () => {
    const app = mountLtiRoutes(ltiTool);

    const jwksResponse = await app.request('/lti/jwks');
    expect(jwksResponse.status).toBe(200);

    const loginResponse = await app.request(
      '/lti/login?iss=https%3A%2F%2Fsakai.example',
      { method: 'GET' },
    );
    expect(loginResponse.status).toBe(400);

    const launchResponse = await app.request('/lti/launch', {
      method: 'POST',
      body: new URLSearchParams().toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(launchResponse.status).toBe(400);
  });

  it('does not mount deep linking or dynamic registration routes', async () => {
    const app = mountLtiRoutes(ltiTool);

    expect((await app.request('/lti/deep-linking')).status).toBe(404);
    expect((await app.request('/lti/register')).status).toBe(404);
    expect((await app.request('/lti/register/complete', { method: 'POST' })).status).toBe(
      404,
    );
  });
});
