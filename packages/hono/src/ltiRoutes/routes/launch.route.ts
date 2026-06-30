import {
  LTI13LaunchSchema,
  type LtiLaunchVerificationErrorCode,
} from '@longsightgroup/lti-tool';
import { type Handler } from 'hono';
import { ZodError } from 'zod';

import { type LtiLaunchRouteDeps } from '../../ltiRouteDeps.js';

/**
 * Creates a route handler for LTI launch requests.
 * @param deps - Protocol dependencies for the launch route
 * @returns Route handler for LTI launch
 */
export function launchRouteHandler(deps: LtiLaunchRouteDeps): Handler {
  return async (c) => {
    try {
      const formData = await c.req.formData();
      const { id_token, state } = LTI13LaunchSchema.parse({
        id_token: formData.get('id_token'),
        state: formData.get('state'),
      });

      const verification = await deps.verifyLaunchDetailed(id_token, state);
      if (!verification.success) {
        const status = launchVerificationErrorStatus(verification.error.code);
        return c.json(
          { error: status === 401 ? 'Authentication failed' : 'Internal server error' },
          status,
        );
      }

      const session = await deps.createSessionFromVerifiedLaunch(verification.launch);

      const targetUrl = new URL(session.launch.target);
      targetUrl.searchParams.set('ltiSessionId', session.id);
      return c.redirect(targetUrl);
    } catch (error) {
      deps.logger.error({ error, path: c.req.path }, 'Launch endpoint error');
      if (error instanceof ZodError) {
        return c.json({ error: 'Invalid launch parameters' }, 400);
      }
      return c.json({ error: 'Internal server error' }, 500);
    }
  };
}

function launchVerificationErrorStatus(code: LtiLaunchVerificationErrorCode): 401 | 500 {
  switch (code) {
    case 'launch_config_invalid':
    case 'launch_config_lookup_failed':
    case 'launch_config_missing_jwks_endpoint':
    case 'launch_config_missing_token_endpoint':
    case 'unknown_error':
      return 500;
    case 'invalid_audience':
    case 'invalid_launch_parameters':
    case 'invalid_payload':
    case 'issuer_mismatch':
    case 'jwt_decode_failed':
    case 'jwt_verification_failed':
    case 'launch_client_not_found':
    case 'launch_config_not_found':
    case 'launch_deployment_not_found':
    case 'missing_deployment_id':
    case 'missing_issuer':
    case 'nonce_mismatch':
    case 'nonce_replay':
    case 'state_verification_failed':
    case 'target_link_uri_mismatch':
    case 'untrusted_audience':
    case 'verified_launch_authorization_failed':
      return 401;
  }
}
