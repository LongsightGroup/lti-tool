import { formatError } from '../utils/errorFormatting.js';

export type LtiServiceErrorCode =
  | 'service_not_available'
  | 'missing_required_scope'
  | 'token_request_failed'
  | 'platform_request_failed'
  | 'platform_response_invalid';

export type LtiServiceKind = 'ags' | 'nrps' | 'token' | 'dynamic_registration';

export interface LtiServiceErrorInput {
  code: LtiServiceErrorCode;
  serviceKind: LtiServiceKind;
  operation: string;
  message: string;
  cause?: unknown;
  endpointType?: string;
  status?: number;
  statusText?: string;
  responseBodySummary?: string;
}

export class LtiServiceError extends Error {
  public readonly code: LtiServiceErrorCode;
  public readonly serviceKind: LtiServiceKind;
  public readonly operation: string;
  public readonly cause?: unknown;
  public readonly endpointType?: string;
  public readonly status?: number;
  public readonly statusText?: string;
  public readonly responseBodySummary?: string;

  constructor(input: LtiServiceErrorInput) {
    super(input.message);
    this.name = 'LtiServiceError';
    this.code = input.code;
    this.serviceKind = input.serviceKind;
    this.operation = input.operation;

    if (input.cause !== undefined) this.cause = input.cause;
    if (input.endpointType !== undefined) this.endpointType = input.endpointType;
    if (input.status !== undefined) this.status = input.status;
    if (input.statusText !== undefined) this.statusText = input.statusText;
    if (input.responseBodySummary !== undefined) {
      this.responseBodySummary = input.responseBodySummary;
    }
  }
}

export type LtiServiceResult<T> =
  | { success: true; data: T; response?: Response }
  | { success: false; error: LtiServiceError };

type LtiServiceFailureResult = { success: false; error: LtiServiceError };
type LtiPlatformServiceKind = Exclude<LtiServiceKind, 'token'>;

type RunLtiServiceCallBaseInput = {
  serviceKind: LtiPlatformServiceKind;
  operation: string;
  request: () => Promise<Response>;
};

type RunLtiServiceJsonCallInput<T> = RunLtiServiceCallBaseInput & {
  responseBody: 'json';
  parse: (data: unknown) => T;
};

type RunLtiServiceEmptyCallInput = RunLtiServiceCallBaseInput & {
  responseBody: 'none';
};

type RunLtiServiceOperationInput<T> = {
  serviceKind: LtiPlatformServiceKind;
  operation: string;
  execute: () => Promise<T>;
};

/**
 * Creates a structured service precondition failure before a platform request is sent.
 */
export function ltiServicePreconditionFailure<T>(input: {
  code: Extract<LtiServiceErrorCode, 'service_not_available' | 'missing_required_scope'>;
  serviceKind: LtiServiceKind;
  operation: string;
  message: string;
}): LtiServiceResult<T> {
  return {
    success: false,
    error: new LtiServiceError(input),
  };
}

/**
 * Runs an LTI platform service request and converts expected request and response failures
 * into structured results.
 */
export async function runLtiServiceCall<T>(
  input: RunLtiServiceJsonCallInput<T>,
): Promise<LtiServiceResult<T>>;

export async function runLtiServiceCall(
  input: RunLtiServiceEmptyCallInput,
): Promise<LtiServiceResult<void>>;

export async function runLtiServiceCall<T>(
  input: RunLtiServiceJsonCallInput<T> | RunLtiServiceEmptyCallInput,
): Promise<LtiServiceResult<T> | LtiServiceResult<void>> {
  try {
    const response = await input.request();

    try {
      if (input.responseBody === 'json') {
        return {
          success: true,
          data: input.parse(await response.json()),
          response,
        };
      }

      return {
        success: true,
        data: undefined,
        response,
      };
    } catch (error) {
      return platformResponseInvalid(input.serviceKind, input.operation, error);
    }
  } catch (error) {
    return ltiServiceFailure(error, input.serviceKind, input.operation);
  }
}

/**
 * Runs a non-HTTP-shaped LTI service operation and converts expected failures into
 * structured results.
 */
export async function runLtiServiceOperation<T>(
  input: RunLtiServiceOperationInput<T>,
): Promise<LtiServiceResult<T>> {
  try {
    return {
      success: true,
      data: await input.execute(),
    };
  } catch (error) {
    return ltiServiceFailure(error, input.serviceKind, input.operation);
  }
}

/**
 * Formats an LTI service error for safe logs, HTTP responses, or persisted failure records.
 */
export function formatLtiServiceError(error: LtiServiceError): string {
  const status =
    error.status === undefined
      ? ''
      : ` status ${error.status}${error.statusText ? ` ${error.statusText}` : ''}`;
  const body = error.responseBodySummary ? `: ${error.responseBodySummary}` : '';
  return `${error.message}${status}${body}`;
}

export async function summarizeLtiServiceResponseBody(
  response: Response,
): Promise<string | undefined> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('json')
      ? JSON.stringify(await response.clone().json())
      : await response.clone().text();
    const normalized = body.replace(/\s+/g, ' ').trim();

    return normalized.length > 300 ? `${normalized.slice(0, 300)}...` : normalized;
  } catch (error) {
    return `Unable to read response body: ${formatError(error)}`;
  }
}

const ltiServiceFailure = (
  error: unknown,
  serviceKind: LtiPlatformServiceKind,
  operation: string,
): LtiServiceFailureResult => {
  if (error instanceof LtiServiceError) {
    return {
      success: false,
      error: new LtiServiceError({
        code: error.code,
        serviceKind,
        operation,
        message: error.message,
        cause: error,
        endpointType: error.endpointType,
        status: error.status,
        statusText: error.statusText,
        responseBodySummary: error.responseBodySummary,
      }),
    };
  }

  const message = formatError(error);

  return {
    success: false,
    error: new LtiServiceError({
      code: 'platform_request_failed',
      serviceKind,
      operation,
      message,
      cause: error,
    }),
  };
};

const platformResponseInvalid = (
  serviceKind: LtiPlatformServiceKind,
  operation: string,
  error: unknown,
): LtiServiceFailureResult => ({
  success: false,
  error: new LtiServiceError({
    code: 'platform_response_invalid',
    serviceKind,
    operation,
    message: formatError(error),
    cause: error,
  }),
});
