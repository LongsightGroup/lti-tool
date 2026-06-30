import type { LTITool } from '@longsightgroup/lti-tool';

import type {
  LtiCompleteDynamicRegistrationRouteDeps,
  LtiDeepLinkRouteDeps,
  LtiInitiateDynamicRegistrationRouteDeps,
} from '../ltiRouteDeps.js';
import { createLtiRouteLogger, type LtiRouteLoggerOptions } from '../ltiRouteLogging.js';

export type CreateLtiOptionalRouteDepsOptions = LtiRouteLoggerOptions & {
  ltiTool: LTITool;
};

export type LtiOptionalRouteDeps = {
  deepLink: LtiDeepLinkRouteDeps;
  initiateDynamicRegistration: LtiInitiateDynamicRegistrationRouteDeps;
  completeDynamicRegistration: LtiCompleteDynamicRegistrationRouteDeps;
};

/**
 * Binds optional LTI route dependencies from an {@link LTITool} instance.
 *
 * Use with `deepLinkRouteHandler`, `initiateDynamicRegistrationRouteHandler`, and
 * `completeDynamicRegistrationRouteHandler` after mounting required routes via
 * {@link createLtiRoutes}.
 */
export function createLtiOptionalRouteDeps(
  options: CreateLtiOptionalRouteDepsOptions,
): LtiOptionalRouteDeps {
  const { ltiTool } = options;
  const logger = createLtiRouteLogger(options);

  return {
    deepLink: {
      getSession: (sessionId) => ltiTool.getSession(sessionId),
      logger,
    },
    initiateDynamicRegistration: {
      initiateDynamicRegistration: (request, routePath) =>
        ltiTool.initiateDynamicRegistration(request, routePath),
      logger,
    },
    completeDynamicRegistration: {
      completeDynamicRegistration: (form) => ltiTool.completeDynamicRegistration(form),
      logger,
    },
  };
}
