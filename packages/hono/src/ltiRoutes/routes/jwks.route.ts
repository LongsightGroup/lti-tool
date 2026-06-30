import { type Handler } from 'hono';

import { type LtiJwksRouteDeps } from '../../ltiRouteDeps.js';

/**
 * Creates a route handler for JWKS requests.
 * @param deps - Protocol dependencies for the JWKS route
 * @returns Route handler for JWKS endpoint
 */
export function jwksRouteHandler(deps: LtiJwksRouteDeps): Handler {
  return async (c) => {
    try {
      return c.json(await deps.getJWKS());
    } catch (error) {
      deps.logger.error({ error, path: c.req.path }, 'JWKS endpoint error');
      return c.json({ error: 'Internal server error' }, 500);
    }
  };
}
