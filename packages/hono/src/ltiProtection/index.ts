import type { LTISession } from '@longsightgroup/lti-tool';
import type { Context, MiddlewareHandler, Next, TypedResponse } from 'hono';
import { endTime, startTime } from 'hono/timing';

import type { LtiSessionMiddlewareDeps } from '../ltiRouteDeps.js';
import { LTIContentRequestSchema } from '../schemas/ltiContentRequest.schema.js';

/**
 * Context variables available when using LTI protection middleware.
 */
export interface LTIContextVariables {
  ltiSession: LTISession;
  ltiSessionId: string;
}

/**
 * Creates middleware that validates LTI sessions and protects routes.
 * @param deps - Session lookup dependency for protected routes
 * @returns Hono middleware handler that validates LTI sessions
 */
export function secureLTISession(deps: LtiSessionMiddlewareDeps): MiddlewareHandler {
  return async (
    c: Context<{ Variables: LTIContextVariables }>,
    next: Next,
  ): Promise<
    | (Response &
        TypedResponse<'LTI session ID required' | 'Invalid LTI session', 403, 'text'>)
    | undefined
  > => {
    startTime(c, 'requireLtiSessionMiddleware');

    const result = LTIContentRequestSchema.safeParse(c.req.query());
    if (!result.success) {
      return c.text('LTI session ID required', 403);
    }

    const { ltiSessionId } = result.data;

    startTime(c, 'getSession');
    const session = await deps.getSession(ltiSessionId);
    endTime(c, 'getSession');
    if (!session) {
      return c.text('Invalid LTI session', 403);
    }

    c.set('ltiSession', session);
    c.set('ltiSessionId', ltiSessionId);

    endTime(c, 'requireLtiSessionMiddleware');
    await next();
  };
}
