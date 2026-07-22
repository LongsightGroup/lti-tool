import {
  formatLtiServiceErrorResponseMetadata,
  LtiServiceError,
} from '../errors/ltiServiceError.js';
import { ltiServiceFetch } from '../utils/ltiServiceFetch.js';

const FETCH_PLATFORM_CONFIGURATION_OPERATION = 'fetchPlatformConfiguration';

const OPENID_CONFIGURATION_REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_OPENID_CONFIGURATION_REDIRECTS = 5;

export type FetchOpenIdConfigurationResult = {
  data: unknown;
  finalHostname: string;
};

const openIdConfigurationServiceError = (input: {
  code: 'platform_request_failed' | 'platform_response_invalid';
  message: string;
  response?: Response;
  cause?: unknown;
  responseBodySummary?: string;
}): LtiServiceError =>
  new LtiServiceError({
    code: input.code,
    serviceKind: 'dynamic_registration',
    operation: FETCH_PLATFORM_CONFIGURATION_OPERATION,
    message: input.message,
    cause: input.cause,
    status: input.response?.status,
    statusText: input.response?.statusText,
    responseBodySummary: input.responseBodySummary,
  });

const withRegistrationToken = (url: URL, registrationToken: string | undefined): URL => {
  if (registrationToken === undefined) {
    return url;
  }

  const next = new URL(url);
  next.searchParams.set('registration_token', registrationToken);
  return next;
};

const requireHttpsUrl = (url: URL, message: string): void => {
  if (url.protocol !== 'https:') {
    throw openIdConfigurationServiceError({
      code: 'platform_response_invalid',
      message,
    });
  }
};

const readOpenIdConfigurationJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type');
  if (contentType === null || !contentType.toLowerCase().includes('json')) {
    throw openIdConfigurationServiceError({
      code: 'platform_response_invalid',
      message: 'Dynamic registration OpenID configuration response must be JSON',
      response,
      responseBodySummary: `content-type: ${contentType ?? 'missing'}`,
    });
  }

  try {
    return await response.json();
  } catch (error) {
    throw openIdConfigurationServiceError({
      code: 'platform_response_invalid',
      message: 'Dynamic registration OpenID configuration response is not valid JSON',
      response,
      cause: error,
    });
  }
};

const readOpenIdConfigurationResponse = async (
  response: Response,
  finalUrl: URL,
): Promise<FetchOpenIdConfigurationResult> => {
  if (!response.ok) {
    throw openIdConfigurationServiceError({
      code: 'platform_request_failed',
      message: 'Dynamic registration OpenID configuration request failed',
      response,
      responseBodySummary: formatLtiServiceErrorResponseMetadata(response),
    });
  }

  const data = await readOpenIdConfigurationJson(response);
  return { data, finalHostname: finalUrl.hostname };
};

const resolveOpenIdConfigurationRedirect = (input: {
  location: string;
  currentUrl: URL;
  trustedOrigin: string;
  registrationToken: string | undefined;
  response: Response;
}): URL => {
  const redirectUrl = new URL(input.location, input.currentUrl);
  requireHttpsUrl(
    redirectUrl,
    'Dynamic registration OpenID configuration redirect must use HTTPS',
  );
  if (redirectUrl.origin !== input.trustedOrigin) {
    throw openIdConfigurationServiceError({
      code: 'platform_response_invalid',
      message:
        'Dynamic registration OpenID configuration redirect must stay on the same origin',
      response: input.response,
    });
  }

  return withRegistrationToken(redirectUrl, input.registrationToken);
};

/**
 * Fetches an LTI platform OpenID configuration during dynamic registration.
 * Follows redirects manually so registration tokens stay on the Authorization header
 * and are re-applied to same-origin redirect target URLs when platforms require query tokens.
 * Redirects remain pinned to the initial origin because forwarding a bearer token across
 * origins would cross the trust boundary established by the registration request.
 */
export async function fetchOpenIdConfiguration(input: {
  openidConfiguration: string;
  registrationToken?: string;
}): Promise<FetchOpenIdConfigurationResult> {
  let url = new URL(input.openidConfiguration);
  const { registrationToken } = input;
  requireHttpsUrl(url, 'Dynamic registration OpenID configuration URL must use HTTPS');
  const trustedOrigin = url.origin;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await ltiServiceFetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        ...(registrationToken === undefined
          ? {}
          : { Authorization: `Bearer ${registrationToken}` }),
        Accept: 'application/json',
      },
    });

    if (!OPENID_CONFIGURATION_REDIRECT_STATUS_CODES.has(response.status)) {
      return readOpenIdConfigurationResponse(response, url);
    }

    if (redirectCount === MAX_OPENID_CONFIGURATION_REDIRECTS) {
      throw openIdConfigurationServiceError({
        code: 'platform_response_invalid',
        message: 'Dynamic registration OpenID configuration redirected too many times',
        response,
      });
    }

    const location = response.headers.get('location');
    if (location === null) {
      throw openIdConfigurationServiceError({
        code: 'platform_response_invalid',
        message:
          'Dynamic registration OpenID configuration redirect is missing a location',
        response,
      });
    }

    url = resolveOpenIdConfigurationRedirect({
      location,
      currentUrl: url,
      trustedOrigin,
      registrationToken,
      response,
    });
  }
}
