import { describe, expect, it } from 'vitest';

import { formatLtiServiceError, LtiServiceError } from '../src/index.js';

describe('LTI service errors', () => {
  it('formats errors with only a safe message', () => {
    const error = new LtiServiceError({
      code: 'service_not_available',
      serviceKind: 'ags',
      operation: 'submitScore',
      message: 'AGS line item service is not available for this session',
    });

    expect(formatLtiServiceError(error)).toBe(
      'AGS line item service is not available for this session',
    );
  });

  it('formats errors with safe HTTP status and response body summary', () => {
    const error = new LtiServiceError({
      code: 'platform_request_failed',
      serviceKind: 'nrps',
      operation: 'getMembers',
      message: 'NRPS get members failed',
      endpointType: 'nrps',
      status: 503,
      statusText: 'Service Unavailable',
      responseBodySummary: '{"error":"membership unavailable"}',
    });

    expect(formatLtiServiceError(error)).toBe(
      'NRPS get members failed status 503 Service Unavailable: {"error":"membership unavailable"}',
    );
  });
});
