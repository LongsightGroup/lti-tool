import { type Handler } from 'hono';

import { type LtiDeepLinkRouteDeps } from '../../ltiRouteDeps.js';

/**
 * Creates a route handler for LTI deep linking requests.
 * @param deps - Protocol dependencies for the deep linking route
 * @returns Route handler for deep linking
 */
export function deepLinkRouteHandler(deps: LtiDeepLinkRouteDeps): Handler {
  return async (c) => {
    try {
      const { ltiSessionId } = c.req.query();
      if (!ltiSessionId) {
        return c.json({ error: 'Session ID required' }, 400);
      }

      const session = await deps.getSession(ltiSessionId);
      if (!session) {
        return c.json({ error: 'Session not found' }, 404);
      }
      const { jwtPayload: _jwtPayload, ...sessionForDebug } = session;

      return c.html(
        `<h1>Hello ${sessionForDebug.user.name}!</h1><h2>This was a deep link launch!</h2><p>Your session id is ${ltiSessionId} and here's an LTI session payload: <pre>${JSON.stringify(sessionForDebug, null, 2)}</pre>`,
      );
    } catch (error) {
      deps.logger.error({ error, path: c.req.path }, 'Deep link endpoint error');
      return c.json({ error: 'Internal server error' }, 500);
    }
  };
}
