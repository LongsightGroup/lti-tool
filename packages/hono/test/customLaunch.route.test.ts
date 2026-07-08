import {
  createNoopLogger,
  LTI_CLAIM_DEEP_LINKING_SETTINGS,
  LTI_CLAIM_MESSAGE_TYPE,
  LTI13JwtPayloadSchema,
  LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
  LtiLaunchVerificationError,
  type LtiAuthorizeVerifiedLaunchOptions,
  type LtiAuthorizedLaunch,
  type LtiLaunchVerificationEvent,
  type LtiLaunchVerificationResult,
  type LtiToolPort,
  type LtiVerifyLaunchEventOptions,
  type LtiVerifyLaunchOptions,
  type LTISession,
} from '@longsightgroup/lti-tool';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { testSession } from '#test-harness/fixtures';
import { createFakeLtiAdvantage, testVerifiedLaunch } from '#test-harness/testing';

import {
  customLaunchRouteHandler,
  type CustomLaunchRouteOptions,
} from '../src/ltiRoutes/routes/customLaunch.route.js';

function launchRequestBody(): string {
  return new URLSearchParams({
    id_token:
      'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL3BsYXRmb3JtLmV4YW1wbGUuY29tIn0.signature',
    state: 'eyJhbGciOiJIUzI1NiJ9.eyJub25jZSI6InRlc3Qtbm9uY2UifQ.signature',
  }).toString();
}

function createToolPort(session: LTISession): LtiToolPort {
  const launch = testVerifiedLaunch();

  function verifyLaunch(
    _idToken: string,
    _state: string,
    options?: LtiVerifyLaunchEventOptions,
  ): Promise<LtiLaunchVerificationResult>;
  function verifyLaunch<TAuthorization>(
    _idToken: string,
    _state: string,
    options: LtiAuthorizeVerifiedLaunchOptions<TAuthorization>,
  ): Promise<LtiLaunchVerificationResult<LtiAuthorizedLaunch<TAuthorization>>>;
  async function verifyLaunch<TAuthorization>(
    _idToken: string,
    _state: string,
    options?: LtiVerifyLaunchOptions<TAuthorization>,
  ): Promise<
    | LtiLaunchVerificationResult
    | LtiLaunchVerificationResult<LtiAuthorizedLaunch<TAuthorization>>
  > {
    if (!options?.authorizeVerifiedLaunch) {
      options?.onVerificationEvent?.({
        type: 'launch_verified',
        issuer: launch.issuer,
        clientId: launch.clientId,
        deploymentId: launch.deploymentId,
      });
      return { success: true, launch };
    }

    const result = await options.authorizeVerifiedLaunch(launch);
    if (!result.success) {
      return {
        success: false,
        error: new LtiLaunchVerificationError(
          'verified_launch_authorization_failed',
          result.message ?? result.code,
          result,
        ),
      };
    }

    options.onVerificationEvent?.({
      type: 'launch_verified',
      issuer: launch.issuer,
      clientId: launch.clientId,
      deploymentId: launch.deploymentId,
    });
    return {
      success: true,
      launch: { ...launch, authorization: result.data },
    };
  }

  return {
    getJWKS: () => Promise.resolve({ keys: [] }),
    handleLogin: () => Promise.resolve('https://platform.example.com/auth'),
    verifyLaunch,
    createSessionFromVerifiedLaunch: () => Promise.resolve(session),
    getSession: () => Promise.resolve(session),
    createAdvantage: () => createFakeLtiAdvantage(),
  };
}

function createFailingToolPort(error: LtiLaunchVerificationError): LtiToolPort {
  const tool = createToolPort(testSession());
  return {
    ...tool,
    verifyLaunch: () => Promise.resolve({ success: false as const, error }),
  };
}

async function requestLaunch(
  tool: LtiToolPort,
  handlerOptions: Partial<CustomLaunchRouteOptions> = {},
) {
  const app = new Hono();
  app.post(
    '/lti/launch',
    customLaunchRouteHandler({
      ltiTool: tool,
      logger: createNoopLogger(),
      renderResourceLink: () => new Response('resource-link'),
      renderDeepLinkingRequest: () => new Response('deep-linking'),
      ...handlerOptions,
    }),
  );

  return await app.request('/lti/launch', {
    method: 'POST',
    body: launchRequestBody(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

describe('customLaunchRouteHandler', () => {
  it('renders resource link launches with verified launch context', async () => {
    const seenSessionIds: string[] = [];
    const session = testSession();
    const response = await requestLaunch(createToolPort(session), {
      renderResourceLink: ({ session: renderedSession }) => {
        seenSessionIds.push(renderedSession.id);
        return new Response(renderedSession.id);
      },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(session.id);
    expect(seenSessionIds).toEqual([session.id]);
  });

  it('passes verification events with Hono context', async () => {
    const seenEvents: Array<{
      readonly path: string;
      readonly event: LtiLaunchVerificationEvent;
    }> = [];
    const response = await requestLaunch(createToolPort(testSession()), {
      onVerificationEvent: ({ hono, event }) => {
        seenEvents.push({ path: hono.req.path, event });
      },
    });

    expect(response.status).toBe(200);
    expect(seenEvents).toEqual([
      {
        path: '/lti/launch',
        event: {
          type: 'launch_verified',
          issuer: 'https://platform.example.com',
          clientId: 'oauth-client-id',
          deploymentId: 'platform-deployment-id',
        },
      },
    ]);
  });

  it('renders deep linking launches with deep linking settings', async () => {
    const baseSession = testSession();
    const session = testSession({
      jwtPayload: LTI13JwtPayloadSchema.parse({
        ...baseSession.jwtPayload,
        [LTI_CLAIM_MESSAGE_TYPE]: LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
        [LTI_CLAIM_DEEP_LINKING_SETTINGS]: {
          deep_link_return_url: 'https://platform.example.com/deep-link-return',
          accept_types: ['ltiResourceLink'],
        },
      }),
      services: {
        deepLinking: {
          returnUrl: 'https://platform.example.com/deep-link-return',
          acceptTypes: ['ltiResourceLink'],
          acceptPresentationDocumentTargets: [],
          acceptMultiple: false,
          autoCreate: false,
        },
      },
      isDeepLinkingAvailable: true,
    });

    const response = await requestLaunch(createToolPort(session), {
      renderDeepLinkingRequest: ({ message }) =>
        new Response(message.deepLinkingSettings.returnUrl),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('https://platform.example.com/deep-link-return');
  });

  it('lets onError override default launch errors', async () => {
    const response = await requestLaunch(createToolPort(testSession()), {
      renderResourceLink: () => {
        throw new Error('render failed');
      },
      onError: () => new Response('custom error', { status: 418 }),
    });

    expect(response.status).toBe(418);
    expect(await response.text()).toBe('custom error');
  });

  it('lets onVerificationFailure map typed verification failures', async () => {
    const error = new LtiLaunchVerificationError(
      'launch_config_missing_jwks_endpoint',
      'JWKS endpoint is not configured',
    );
    const response = await requestLaunch(createFailingToolPort(error), {
      onVerificationFailure: ({ error: failure }) =>
        new Response(failure.code, { status: 501 }),
    });

    expect(response.status).toBe(501);
    expect(await response.text()).toBe('launch_config_missing_jwks_endpoint');
  });

  it('uses the default verification failure response when no hook is provided', async () => {
    const response = await requestLaunch(
      createFailingToolPort(
        new LtiLaunchVerificationError('nonce_replay', 'Nonce replay'),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication failed' });
  });

  it('uses the default internal server error response for config failures without a hook', async () => {
    const response = await requestLaunch(
      createFailingToolPort(
        new LtiLaunchVerificationError(
          'launch_config_missing_jwks_endpoint',
          'JWKS endpoint is not configured',
        ),
      ),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });

  it('does not route result-based verification failures through onError', async () => {
    const onError = vi.fn(() => new Response('wrong path', { status: 418 }));
    const response = await requestLaunch(
      createFailingToolPort(
        new LtiLaunchVerificationError('nonce_replay', 'Nonce replay'),
      ),
      { onError },
    );

    expect(response.status).toBe(401);
    expect(onError).not.toHaveBeenCalled();
  });
});
