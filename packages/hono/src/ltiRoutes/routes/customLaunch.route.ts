import {
  LtiLaunchMessageResolutionError,
  resolveLtiLaunchMessage,
  type LtiAdvantagePort,
  type LtiAuthorizedLaunch,
  type LtiLogger,
  type LtiLaunchVerificationResult,
  type LtiToolPort,
  type LtiVerifiedLaunch,
  type LtiVerifiedLaunchAuthorizationResult,
  type ResolvedLtiDeepLinkingLaunchMessage,
  type ResolvedLtiResourceLinkLaunchMessage,
  type LTISession,
} from '@longsightgroup/lti-tool';
import { type Context, type Handler } from 'hono';
import { ZodError } from 'zod';

import {
  verifyLaunchRequest,
  type HonoLtiLaunchVerificationEventObserver,
  type LtiLaunchVerificationFailureResponse,
  type VerifyLaunchEventOptions,
} from '../launchFlow.js';

type CustomLaunchContext<TLaunch extends LtiVerifiedLaunch> = {
  readonly hono: Context;
  readonly launch: TLaunch;
  readonly session: LTISession;
  readonly advantage: LtiAdvantagePort;
};

/**
 * Context supplied to a custom Resource Link launch renderer.
 */
export type CustomResourceLinkLaunchContext<TLaunch extends LtiVerifiedLaunch> =
  CustomLaunchContext<TLaunch> & {
    readonly message: ResolvedLtiResourceLinkLaunchMessage;
  };

/**
 * Context supplied to a custom Deep Linking request renderer.
 */
export type CustomDeepLinkingLaunchContext<TLaunch extends LtiVerifiedLaunch> =
  CustomLaunchContext<TLaunch> & {
    readonly message: ResolvedLtiDeepLinkingLaunchMessage;
  };

/**
 * Context supplied after launch verification and session creation.
 */
export type CustomVerifiedLaunchContext<TLaunch extends LtiVerifiedLaunch> =
  CustomLaunchContext<TLaunch> & {
    readonly message:
      | ResolvedLtiDeepLinkingLaunchMessage
      | ResolvedLtiResourceLinkLaunchMessage;
  };

export type CustomLaunchErrorContext = {
  readonly hono: Context;
  readonly error: unknown;
};

export type CustomLaunchResponse = Response | Promise<Response>;

type CustomLaunchRendererOptions<TLaunch extends LtiVerifiedLaunch> = {
  readonly ltiTool: LtiToolPort;
  readonly logger: LtiLogger;
  readonly onVerifiedLaunch?: (
    context: CustomVerifiedLaunchContext<TLaunch>,
  ) => void | Promise<void>;
  readonly onVerificationFailure?: LtiLaunchVerificationFailureResponse;
  readonly onVerificationEvent?: HonoLtiLaunchVerificationEventObserver;
  readonly renderResourceLink: (
    context: CustomResourceLinkLaunchContext<TLaunch>,
  ) => CustomLaunchResponse;
  readonly renderDeepLinkingRequest: (
    context: CustomDeepLinkingLaunchContext<TLaunch>,
  ) => CustomLaunchResponse;
  readonly onError?: (context: CustomLaunchErrorContext) => CustomLaunchResponse;
};

export type CustomLaunchRouteOptions = CustomLaunchRendererOptions<LtiVerifiedLaunch> & {
  readonly authorizeLaunch?: undefined;
};

export type AuthorizedCustomLaunchRouteOptions<TAuthorization> =
  CustomLaunchRendererOptions<LtiAuthorizedLaunch<TAuthorization>> & {
    readonly authorizeLaunch: (
      launch: LtiVerifiedLaunch,
    ) =>
      | LtiVerifiedLaunchAuthorizationResult<TAuthorization>
      | Promise<LtiVerifiedLaunchAuthorizationResult<TAuthorization>>;
  };

/**
 * Creates a custom LTI launch handler that owns protocol verification and lets
 * applications render Resource Link and Deep Linking launches.
 */
export function customLaunchRouteHandler(options: CustomLaunchRouteOptions): Handler;

export function customLaunchRouteHandler<TAuthorization>(
  options: AuthorizedCustomLaunchRouteOptions<TAuthorization>,
): Handler;

export function customLaunchRouteHandler<TAuthorization>(
  options: CustomLaunchRouteOptions | AuthorizedCustomLaunchRouteOptions<TAuthorization>,
): Handler {
  if (options.authorizeLaunch) {
    return createAuthorizedCustomLaunchRouteHandler(options);
  }

  return createCustomLaunchRouteHandler(options, (idToken, state, verifyOptions) =>
    options.ltiTool.verifyLaunch(idToken, state, verifyOptions),
  );
}

function createAuthorizedCustomLaunchRouteHandler<TAuthorization>(
  options: AuthorizedCustomLaunchRouteOptions<TAuthorization>,
): Handler {
  return createCustomLaunchRouteHandler(options, (idToken, state, verifyOptions) =>
    options.ltiTool.verifyLaunch(idToken, state, {
      authorizeVerifiedLaunch: options.authorizeLaunch,
      onVerificationEvent: verifyOptions?.onVerificationEvent,
    }),
  );
}

function createCustomLaunchRouteHandler<TLaunch extends LtiVerifiedLaunch>(
  options: CustomLaunchRendererOptions<TLaunch>,
  verifyLaunch: (
    idToken: string,
    state: string,
    options?: VerifyLaunchEventOptions,
  ) => Promise<LtiLaunchVerificationResult<TLaunch>>,
): Handler {
  return async (c) => {
    try {
      const verification = await verifyLaunchRequest(c, {
        verifyLaunch,
        onVerificationFailure: options.onVerificationFailure,
        onVerificationEvent: options.onVerificationEvent,
      });
      if (!verification.success) return verification.response;

      const session = await options.ltiTool.createSessionFromVerifiedLaunch(
        verification.launch,
      );
      const message = resolveLtiLaunchMessage(session);
      const advantage = options.ltiTool.createAdvantage(session);
      const context = {
        hono: c,
        launch: verification.launch,
        session,
        advantage,
        message,
      };

      await options.onVerifiedLaunch?.(context);

      switch (message.kind) {
        case 'resource-link':
          return await options.renderResourceLink({ ...context, message });
        case 'deep-linking':
          return await options.renderDeepLinkingRequest({ ...context, message });
        default: {
          const unsupported: never = message;
          throw new LtiLaunchMessageResolutionError(
            'unsupported_message_type',
            `Unsupported LTI launch message kind: ${String(unsupported)}`,
          );
        }
      }
    } catch (error) {
      return await renderCustomLaunchError(c, options, error);
    }
  };
}

async function renderCustomLaunchError<TLaunch extends LtiVerifiedLaunch>(
  c: Context,
  options: Pick<CustomLaunchRendererOptions<TLaunch>, 'logger' | 'onError'>,
  error: unknown,
): Promise<Response> {
  options.logger.error({ error, path: c.req.path }, 'Custom launch endpoint error');
  if (options.onError) return await options.onError({ hono: c, error });
  if (error instanceof ZodError) {
    return c.json({ error: 'Invalid launch parameters' }, 400);
  }
  if (error instanceof LtiLaunchMessageResolutionError) {
    return c.json({ error: 'Unsupported launch message' }, 400);
  }
  return c.json({ error: 'Internal server error' }, 500);
}
