import type { LTITool } from '@longsightgroup/lti-tool';
import { Hono } from 'hono';

import type {
  LtiJwksRouteDeps,
  LtiLaunchRouteDeps,
  LtiLoginRouteDeps,
} from '../ltiRouteDeps.js';
import { createLtiRouteLogger, type LtiRouteLoggerOptions } from '../ltiRouteLogging.js';

import { jwksRouteHandler } from './routes/jwks.route.js';
import { launchRouteHandler } from './routes/launch.route.js';
import { loginRouteHandler } from './routes/login.route.js';

export type CreateLtiRoutesOptions = LtiRouteLoggerOptions & {
  ltiTool: LTITool;
};

/**
 * Creates a Hono sub-app with required LTI 1.3 protocol routes.
 *
 * Mount on your app with `app.route('/lti', createLtiRoutes({ ltiTool }))` to serve
 * `/lti/jwks`, `/lti/login`, and `/lti/launch`. Login and launch must remain sibling
 * paths under the mount prefix.
 *
 * Mount deep linking and dynamic registration with their explicit route handlers when needed.
 */
export function createLtiRoutes(options: CreateLtiRoutesOptions): Hono {
  const { ltiTool } = options;
  const logger = createLtiRouteLogger(options);
  const jwksDeps: LtiJwksRouteDeps = {
    getJWKS: () => ltiTool.getJWKS(),
    logger,
  };
  const loginDeps: LtiLoginRouteDeps = {
    handleLogin: (params) => ltiTool.handleLogin(params),
    logger,
  };
  const launchDeps: LtiLaunchRouteDeps = {
    verifyLaunchDetailed: (idToken, state) =>
      ltiTool.verifyLaunchDetailed(idToken, state),
    createSessionFromVerifiedLaunch: (launch) =>
      ltiTool.createSessionFromVerifiedLaunch(launch),
    logger,
  };
  const app = new Hono();

  app.get('/jwks', jwksRouteHandler(jwksDeps));
  app.get('/login', loginRouteHandler(loginDeps));
  app.post('/login', loginRouteHandler(loginDeps));
  app.post('/launch', launchRouteHandler(launchDeps));

  return app;
}
