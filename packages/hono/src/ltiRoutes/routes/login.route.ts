import {
  LTI13LoginSchema,
  createLtiPostMessageStorageRedirect,
  parseLtiLoginInitiation,
  renderLtiPostMessageStorageRedirectPage,
  type LTI13LoginInitiation,
} from '@longsightgroup/lti-tool';
import { type Context, type Handler } from 'hono';
import { ZodError } from 'zod';

import { type LtiLoginRouteDeps } from '../../ltiRouteDeps.js';

/**
 * Creates a route handler for LTI login requests.
 * @param deps - Protocol dependencies for the login route
 * @returns Route handler for LTI login
 */
export function loginRouteHandler(deps: LtiLoginRouteDeps): Handler {
  return async (c) => {
    try {
      const params = await getLoginInitiationParams(c);
      const baseUrl = new URL(c.req.url).origin;
      const currentPath = new URL(c.req.url).pathname;
      const launchPath = currentPath.replace(/\/login$/, '/launch');
      const launchUrl = new URL(launchPath, baseUrl);
      const handleLoginParams = LTI13LoginSchema.parse(params);

      const authRedirectUrl = await deps.handleLogin({
        ...handleLoginParams,
        launchUrl,
      });
      const storageResponse = renderPostMessageStorageResponse(c, {
        authorizationRedirectUrl: authRedirectUrl,
        storageTarget: params.lti_storage_target,
      });
      if (storageResponse) return storageResponse;

      return c.redirect(authRedirectUrl);
    } catch (error) {
      deps.logger.error({ error, path: c.req.path }, 'Login endpoint error');
      if (error instanceof ZodError) {
        return c.json({ error: 'Invalid request parameters' }, 400);
      }
      return c.json({ error: 'Internal server error' }, 500);
    }
  };
}

async function getLoginInitiationParams(c: Context): Promise<LTI13LoginInitiation> {
  if (c.req.method === 'GET') {
    return parseLtiLoginInitiation({
      iss: c.req.query('iss'),
      login_hint: c.req.query('login_hint'),
      target_link_uri: c.req.query('target_link_uri'),
      client_id: c.req.query('client_id'),
      lti_deployment_id: c.req.query('lti_deployment_id'),
      lti_message_hint: c.req.query('lti_message_hint'),
      lti_storage_target: c.req.query('lti_storage_target'),
    });
  }

  const formData = await c.req.formData();
  return parseLtiLoginInitiation({
    iss: formData.get('iss'),
    login_hint: formData.get('login_hint'),
    target_link_uri: formData.get('target_link_uri'),
    client_id: formData.get('client_id'),
    lti_deployment_id: formData.get('lti_deployment_id'),
    lti_message_hint: formData.get('lti_message_hint'),
    lti_storage_target: formData.get('lti_storage_target'),
  });
}

function renderPostMessageStorageResponse(
  c: Context,
  input: { authorizationRedirectUrl: string; storageTarget?: string },
): Response | null {
  const postMessageStorageRedirect = createLtiPostMessageStorageRedirect(input);
  if (!postMessageStorageRedirect) return null;

  c.header('Cache-Control', 'no-store');
  return c.html(renderLtiPostMessageStorageRedirectPage(postMessageStorageRedirect));
}
