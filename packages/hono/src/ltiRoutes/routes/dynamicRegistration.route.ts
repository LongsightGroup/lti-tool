import {
  DynamicRegistrationFormSchema,
  type LtiServiceError,
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
      const appState = await deps.getDynamicRegistrationAppState?.({
        hono: c,
        registrationRequest: validated,
      });
      const initiationOptions = appState === undefined ? undefined : { appState };
      const result = await deps.initiateDynamicRegistration(
        validated,
        c.req.path,
        initiationOptions,
      );
      if (!result.success) {
        deps.logger.error(
          { error: result.error, path: c.req.path },
          'lti dynamic registration initiation failed',
        );
        return c.json(
          { error: dynamicRegistrationErrorMessage(result.error) },
          dynamicRegistrationErrorStatus(result.error),
        );
      }

      return c.html(result.data);
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

      const result = await deps.completeDynamicRegistration(validated);
      if (!result.success) {
        deps.logger.error(
          { error: result.error, path: c.req.path },
          'lti dynamic registration completion failed',
        );
        return c.json(
          { error: dynamicRegistrationErrorMessage(result.error) },
          dynamicRegistrationErrorStatus(result.error),
        );
      }

      try {
        await deps.onRegistrationComplete?.(result.data);
      } catch (error) {
        deps.logger.error(
          { error, path: c.req.path },
          'lti dynamic registration completion callback failed',
        );
      }

      return c.html(result.data.html);
    } catch (error) {
      deps.logger.error({ error }, 'lti dynamic registration completion error');
      if (error instanceof ZodError) {
        return c.json({ error: 'Invalid request data' }, 400);
      }
      return c.json({ error: 'Internal server error' }, 500);
    }
  };
}

function dynamicRegistrationErrorStatus(error: LtiServiceError): 400 | 500 {
  switch (error.code) {
    case 'registration_session_expired':
    case 'platform_registration_rejected':
    case 'storage_conflict':
    case 'invalid_request':
      return 400;
    case 'service_not_available':
    case 'missing_required_scope':
    case 'token_request_failed':
    case 'platform_request_failed':
    case 'platform_response_invalid':
      return 500;
  }
}

function dynamicRegistrationErrorMessage(error: LtiServiceError): string {
  switch (error.code) {
    case 'registration_session_expired':
      return 'Registration session is invalid or expired';
    case 'platform_registration_rejected':
      return 'Platform rejected registration';
    case 'storage_conflict':
      return 'Registration conflicts with existing configuration';
    case 'service_not_available':
      return 'Dynamic registration is not available';
    case 'missing_required_scope':
      return 'Dynamic registration is missing a required scope';
    case 'invalid_request':
      return 'Invalid request';
    case 'token_request_failed':
    case 'platform_request_failed':
    case 'platform_response_invalid':
      return 'Internal server error';
  }
}
