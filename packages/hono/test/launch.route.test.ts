import { createNoopLogger, LtiLaunchVerificationError } from '@longsightgroup/lti-tool';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { LtiLaunchRouteDeps } from '../src/ltiRouteDeps.js';
import { launchRouteHandler } from '../src/ltiRoutes/routes/launch.route.js';

function launchRequestBody(): string {
  return new URLSearchParams({
    id_token:
      'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL3BsYXRmb3JtLmV4YW1wbGUuY29tIn0.signature',
    state: 'eyJhbGciOiJIUzI1NiJ9.eyJub25jZSI6InRlc3Qtbm9uY2UifQ.signature',
  }).toString();
}

async function requestLaunch(deps: LtiLaunchRouteDeps): Promise<Response> {
  const app = new Hono();
  app.post('/lti/launch', launchRouteHandler(deps));

  return await app.request('/lti/launch', {
    method: 'POST',
    body: launchRequestBody(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

describe('launchRouteHandler', () => {
  it('maps launch verification rejection codes to authentication failures', async () => {
    const createSessionFromVerifiedLaunch = vi.fn();
    const response = await requestLaunch({
      verifyLaunchDetailed: () =>
        Promise.resolve({
          success: false,
          error: new LtiLaunchVerificationError('nonce_replay', 'Nonce replay'),
        }),
      createSessionFromVerifiedLaunch,
      logger: createNoopLogger(),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication failed' });
    expect(createSessionFromVerifiedLaunch).not.toHaveBeenCalled();
  });

  it('maps launch verification dependency failures to internal server errors', async () => {
    const createSessionFromVerifiedLaunch = vi.fn();
    const response = await requestLaunch({
      verifyLaunchDetailed: () =>
        Promise.resolve({
          success: false,
          error: new LtiLaunchVerificationError(
            'launch_config_lookup_failed',
            'Launch config lookup failed',
          ),
        }),
      createSessionFromVerifiedLaunch,
      logger: createNoopLogger(),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(createSessionFromVerifiedLaunch).not.toHaveBeenCalled();
  });
});
