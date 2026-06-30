import {
  DynamicRegistrationFormSchema,
  RegistrationRequestSchema,
} from '@longsightgroup/lti-tool';
import { type Handler } from 'hono';
import { ZodError } from 'zod';

import {
  type LtiCompleteDynamicRegistrationRouteDeps,
  type LtiInitiateDynamicRegistrationRouteDeps,
} from '../../ltiRouteDeps.js';

/**
 * Creates a Hono route handler for initiating LTI 1.3 dynamic registration.
 *
 * @param deps - Protocol dependencies for registration initiation
 * @returns Hono handler that processes registration initiation requests and returns HTML form
 */
export function initiateDynamicRegistrationRouteHandler(
  deps: LtiInitiateDynamicRegistrationRouteDeps,
): Handler {
  return async (c) => {
    try {
      const queryData = c.req.query();
      const validated = RegistrationRequestSchema.parse(queryData);
      const formHtml = await deps.initiateDynamicRegistration(validated, c.req.path);

      return c.html(formHtml);
    } catch (error) {
      deps.logger.error(
        { error, path: c.req.path },
        'lti dynamic registration initiation error',
      );
      if (error instanceof ZodError) {
        return c.json({ error: 'Invalid request data' }, 400);
      }
      return c.json({ error: 'Internal server error' }, 500);
    }
  };
}

/**
 * Creates a Hono route handler for completing LTI 1.3 dynamic registration.
 *
 * @param deps - Protocol dependencies for registration completion
 * @returns Hono handler that processes registration completion and returns HTML success page
 */
export function completeDynamicRegistrationRouteHandler(
  deps: LtiCompleteDynamicRegistrationRouteDeps,
): Handler {
  return async (c) => {
    try {
      const formData = await c.req.parseBody({ all: true });
      const normalizedFormData = {
        ...formData,
        services:
          typeof formData.services === 'string' ? [formData.services] : formData.services,
      };
      const validated = DynamicRegistrationFormSchema.parse(normalizedFormData);

      const successHtml = await deps.completeDynamicRegistration(validated);

      return c.html(successHtml);
    } catch (error) {
      deps.logger.error({ error }, 'lti dynamic registration completion error');
      if (error instanceof ZodError) {
        return c.json({ error: 'Invalid request data' }, 400);
      }
      return c.json({ error: 'Internal server error' }, 500);
    }
  };
}
