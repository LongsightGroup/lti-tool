import { createNoopLogger, LtiServiceError } from '@longsightgroup/lti-tool';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LtiCompleteDynamicRegistrationRouteDeps,
  LtiInitiateDynamicRegistrationRouteDeps,
} from '../src/ltiRouteDeps.js';
import {
  completeDynamicRegistrationRouteHandler,
  initiateDynamicRegistrationRouteHandler,
} from '../src/ltiRoutes/routes/dynamicRegistration.route.js';

const completeDynamicRegistrationMock = vi.fn();
const initiateDynamicRegistrationMock = vi.fn();

function createCompleteRegistrationRouteDeps(): LtiCompleteDynamicRegistrationRouteDeps {
  return {
    completeDynamicRegistration: completeDynamicRegistrationMock,
    logger: createNoopLogger(),
  };
}

function createInitiateRegistrationRouteDeps(): LtiInitiateDynamicRegistrationRouteDeps {
  return {
    initiateDynamicRegistration: initiateDynamicRegistrationMock,
    logger: createNoopLogger(),
  };
}

describe('initiateDynamicRegistrationRouteHandler', () => {
  let deps: LtiInitiateDynamicRegistrationRouteDeps;

  beforeEach(() => {
    initiateDynamicRegistrationMock.mockReset();
    deps = createInitiateRegistrationRouteDeps();
  });

  it('returns 400 when required query params are missing', async () => {
    const app = new Hono();
    app.get('/lti/register', initiateDynamicRegistrationRouteHandler(deps));

    const response = await app.request('/lti/register');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request data' });
    expect(initiateDynamicRegistrationMock).not.toHaveBeenCalled();
  });

  it('returns 500 when registration initiation fails after parsing', async () => {
    initiateDynamicRegistrationMock.mockResolvedValueOnce({
      success: false,
      error: new LtiServiceError({
        code: 'platform_request_failed',
        serviceKind: 'dynamic_registration',
        operation: 'initiateDynamicRegistration',
        message: 'platform unavailable',
      }),
    });

    const app = new Hono();
    app.get('/lti/register', initiateDynamicRegistrationRouteHandler(deps));

    const response = await app.request(
      '/lti/register?openid_configuration=https%3A%2F%2Fplatform.example%2F.well-known%2Fopenid-configuration&registration_token=token-1',
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(initiateDynamicRegistrationMock).toHaveBeenCalledOnce();
  });
});

describe('completeDynamicRegistrationRouteHandler', () => {
  let deps: LtiCompleteDynamicRegistrationRouteDeps;

  beforeEach(() => {
    completeDynamicRegistrationMock.mockReset();
    deps = createCompleteRegistrationRouteDeps();
  });

  it('accepts a single selected service from an html form post', async () => {
    completeDynamicRegistrationMock.mockResolvedValueOnce({
      success: true,
      data: {
        html: '<html><body>Registration complete</body></html>',
      },
    });

    const app = new Hono();
    app.post('/lti/register/complete', completeDynamicRegistrationRouteHandler(deps));

    const body = new URLSearchParams({
      services: 'deep_linking',
      sessionToken: 'session-token-123',
    });

    const response = await app.request('/lti/register/complete', {
      method: 'POST',
      body: body.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    });

    expect(response.status).toBe(200);
    expect(completeDynamicRegistrationMock).toHaveBeenCalledWith({
      services: ['deep_linking'],
      sessionToken: 'session-token-123',
    });
  });

  it('returns 500 when registration completion fails after parsing', async () => {
    completeDynamicRegistrationMock.mockResolvedValueOnce({
      success: false,
      error: new LtiServiceError({
        code: 'platform_request_failed',
        serviceKind: 'dynamic_registration',
        operation: 'completeDynamicRegistration',
        message: 'registration unavailable',
      }),
    });

    const app = new Hono();
    app.post('/lti/register/complete', completeDynamicRegistrationRouteHandler(deps));

    const body = new URLSearchParams({
      services: 'deep_linking',
      sessionToken: 'session-token-123',
    });

    const response = await app.request('/lti/register/complete', {
      method: 'POST',
      body: body.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(completeDynamicRegistrationMock).toHaveBeenCalledOnce();
  });
});
