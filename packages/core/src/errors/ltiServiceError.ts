import { formatError } from '../utils/errorFormatting.js';

export type LtiServiceErrorCode =
  | 'service_not_available'
  | 'missing_required_scope'
  | 'token_request_failed'
  | 'platform_request_failed'
  | 'platform_response_invalid';

export type LtiServiceKind = 'ags' | 'nrps' | 'token';

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
