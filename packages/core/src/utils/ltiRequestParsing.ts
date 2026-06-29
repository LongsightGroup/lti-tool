import * as z from 'zod';

import {
  type DeepLinkingContentItem,
  ContentItemSchema,
  LTI13LaunchSchema,
  parseLtiLoginInitiation,
} from '../schemas/index.js';

export type LtiRequestParseErrorCode =
  | 'missing_required_parameter'
  | 'invalid_parameter'
  | 'invalid_content_items'
  | 'invalid_json_body';

export class LtiRequestParseError extends Error {
  constructor(
    public readonly code: LtiRequestParseErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LtiRequestParseError';
  }
}

export interface ParsedLtiLaunchForm {
  idToken: string;
  state: string;
}

export interface ParsedLtiDeepLinkingResponseRequest {
  contentItems: DeepLinkingContentItem[];
}

type RequestParameters = Record<string, unknown>;

const contentItemsSchema = z.array(ContentItemSchema);

const requestParametersFromUrlSearchParams = (
  searchParams: URLSearchParams,
): RequestParameters => {
  const parameters: RequestParameters = {};

  for (const [key, value] of searchParams.entries()) {
    parameters[key] = value;
  }

  return parameters;
};

const requestParametersFromFormData = (formData: FormData): RequestParameters => {
  const parameters: RequestParameters = {};

  for (const [key, value] of formData.entries()) {
    parameters[key] = value;
  }

  return parameters;
};

const requestParametersFromInput = async (
  input: Request | FormData | URLSearchParams | RequestParameters,
): Promise<RequestParameters> => {
  if (input instanceof Request) {
    return requestParametersFromFormData(await input.formData());
  }

  if (input instanceof FormData) {
    return requestParametersFromFormData(input);
  }

  if (input instanceof URLSearchParams) {
    return requestParametersFromUrlSearchParams(input);
  }

  return input;
};

const stringParameter = (
  parameters: RequestParameters,
  parameterName: string,
): string | undefined => {
  const value = parameters[parameterName];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const requireStringParameter = (
  parameters: RequestParameters,
  parameterName: string,
): string => {
  const value = stringParameter(parameters, parameterName);

  if (value === undefined) {
    throw new LtiRequestParseError(
      'missing_required_parameter',
      `Missing required LTI parameter '${parameterName}'`,
    );
  }

  return value;
};

const parseJsonString = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new LtiRequestParseError('invalid_json_body', 'Invalid JSON body', error);
  }
};

const urlSearchParamsFromLoginInput = (
  input: URL | string | URLSearchParams,
): URLSearchParams => {
  if (input instanceof URL) {
    return input.searchParams;
  }

  if (typeof input !== 'string') {
    return input;
  }

  try {
    return new URL(input).searchParams;
  } catch (error) {
    throw new LtiRequestParseError(
      'invalid_parameter',
      'Invalid LTI login request URL',
      error,
    );
  }
};

/**
 * Parses LTI OIDC login query parameters from a URL or URLSearchParams.
 */
export const parseLtiLoginRequest = (
  input: URL | string | URLSearchParams,
): ReturnType<typeof parseLtiLoginInitiation> => {
  const parameters = requestParametersFromUrlSearchParams(
    urlSearchParamsFromLoginInput(input),
  );

  requireStringParameter(parameters, 'iss');
  requireStringParameter(parameters, 'login_hint');
  requireStringParameter(parameters, 'target_link_uri');

  try {
    return parseLtiLoginInitiation(parameters);
  } catch (error) {
    throw new LtiRequestParseError(
      'invalid_parameter',
      'Invalid LTI login request',
      error,
    );
  }
};

/**
 * Parses an LTI launch form post and normalizes id_token to idToken.
 */
export const parseLtiLaunchFormData = async (
  input: Request | FormData | URLSearchParams | RequestParameters,
): Promise<ParsedLtiLaunchForm> => {
  const parameters = await requestParametersFromInput(input);
  const candidate = {
    id_token: requireStringParameter(parameters, 'id_token'),
    state: requireStringParameter(parameters, 'state'),
  };
  const parsed = LTI13LaunchSchema.safeParse(candidate);

  if (!parsed.success) {
    throw new LtiRequestParseError(
      'invalid_parameter',
      'Invalid LTI launch form',
      parsed.error,
    );
  }

  return {
    idToken: parsed.data.id_token,
    state: parsed.data.state,
  };
};

/**
 * Parses a Deep Linking response request body containing content_items.
 */
export const parseLtiDeepLinkingResponseRequest = (
  input: string | unknown[] | RequestParameters,
): ParsedLtiDeepLinkingResponseRequest => {
  const body = typeof input === 'string' ? parseJsonString(input) : input;
  const contentItemsCandidate =
    Array.isArray(body) || typeof body === 'string'
      ? body
      : body !== null && typeof body === 'object' && !Array.isArray(body)
        ? (body as RequestParameters).content_items
        : undefined;
  const contentItems =
    typeof contentItemsCandidate === 'string'
      ? parseJsonString(contentItemsCandidate)
      : contentItemsCandidate;

  if (contentItems === undefined) {
    throw new LtiRequestParseError(
      'missing_required_parameter',
      "Missing required LTI parameter 'content_items'",
    );
  }

  const parsed = contentItemsSchema.safeParse(contentItems);

  if (!parsed.success) {
    throw new LtiRequestParseError(
      'invalid_content_items',
      'Invalid LTI Deep Linking content items',
      parsed.error,
    );
  }

  return { contentItems: parsed.data };
};
