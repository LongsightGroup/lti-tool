import {
  isLtiPlatformServiceErrorCode,
  LTI_CLAIM_DEPLOYMENT_ID,
  LTI_CLAIM_TARGET_LINK_URI,
  LTI13JwtPayloadSchema,
  LtiServiceError,
  type CreateLineItem,
  type DeepLinkingContentItem,
  type LtiAdvantagePort,
  type LtiServiceErrorCode,
  type LtiServiceKind,
  type LtiServiceResult,
  type LtiVerifiedLaunch,
  type Member,
  type NrpsGetMembersOptions,
  type NrpsMembersResult,
  type ScoreSubmission,
  type UpdateLineItem,
} from '@longsightgroup/lti-tool';

import { createMockLTIPayload, testLaunchConfig } from './fixtures.js';

/**
 * Builds a verified launch fixture with coherent launch config defaults.
 */
export function testVerifiedLaunch(
  overrides: Partial<LtiVerifiedLaunch> = {},
): LtiVerifiedLaunch {
  const launchConfig = overrides.launchConfig ?? testLaunchConfig();
  const payload = LTI13JwtPayloadSchema.parse({
    ...createMockLTIPayload({
      aud: launchConfig.clientId,
      [LTI_CLAIM_DEPLOYMENT_ID]: launchConfig.deploymentId,
      [LTI_CLAIM_TARGET_LINK_URI]: 'https://tool.example.com/launch',
    }),
    ...overrides.payload,
  });

  return {
    payload,
    issuer: launchConfig.iss,
    clientId: launchConfig.clientId,
    deploymentId: launchConfig.deploymentId,
    targetLinkUri: payload[LTI_CLAIM_TARGET_LINK_URI],
    launchConfig,
    ...overrides,
  };
}

/**
 * Builds a structured LTI service error fixture.
 */
export function createTestServiceError(
  input: {
    readonly code?: LtiServiceErrorCode;
    readonly serviceKind?: LtiServiceKind;
    readonly operation?: string;
    readonly message?: string;
    readonly cause?: unknown;
  } = {},
): LtiServiceError {
  if (input.serviceKind === 'dynamic_registration') {
    return new LtiServiceError({
      code: input.code ?? 'service_not_available',
      serviceKind: 'dynamic_registration',
      operation: input.operation ?? 'testOperation',
      message: input.message ?? 'Test LTI service error',
      ...(input.cause === undefined ? {} : { cause: input.cause }),
    });
  }

  const requestedCode = input.code ?? 'service_not_available';
  const code = isLtiPlatformServiceErrorCode(requestedCode)
    ? requestedCode
    : 'service_not_available';

  return new LtiServiceError({
    code,
    serviceKind: input.serviceKind ?? 'ags',
    operation: input.operation ?? 'testOperation',
    message: input.message ?? 'Test LTI service error',
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

function fakeGetMembers(): Promise<LtiServiceResult<Member[]>>;
function fakeGetMembers(options: {
  readonly followPagination?: false | undefined;
}): Promise<LtiServiceResult<Member[]>>;
function fakeGetMembers(options: {
  readonly followPagination: true;
  readonly maxPages?: number;
}): Promise<LtiServiceResult<NrpsMembersResult>>;
function fakeGetMembers(
  _options: NrpsGetMembersOptions = {},
): Promise<LtiServiceResult<unknown>> {
  return Promise.resolve(unavailable('nrps', 'getMembers'));
}

/**
 * Builds a fake session-bound Advantage client for app tests.
 */
export function createFakeLtiAdvantage(
  overrides: Partial<LtiAdvantagePort> = {},
): LtiAdvantagePort {
  return {
    submitScore: (_score: ScoreSubmission) =>
      Promise.resolve(unavailable('ags', 'submitScore')),
    getScores: (_options = {}) => Promise.resolve(unavailable('ags', 'getScores')),
    listLineItems: (_options = {}) =>
      Promise.resolve(unavailable('ags', 'listLineItems')),
    getLineItem: (_options = {}) => Promise.resolve(unavailable('ags', 'getLineItem')),
    createLineItem: (_createLineItem: CreateLineItem) =>
      Promise.resolve(unavailable('ags', 'createLineItem')),
    updateLineItem: (_updateLineItem: UpdateLineItem) =>
      Promise.resolve(unavailable('ags', 'updateLineItem')),
    deleteLineItem: () => Promise.resolve(unavailable('ags', 'deleteLineItem')),
    findOrCreateLineItem: (_input) =>
      Promise.resolve(unavailable('ags', 'findOrCreateLineItem')),
    getMembers: fakeGetMembers,
    getMembersPage: (_pageUrl) => Promise.resolve(unavailable('nrps', 'getMembersPage')),
    createDeepLinkingResponse: (_contentItems: DeepLinkingContentItem[]) =>
      Promise.resolve(unavailable('deep_linking', 'createDeepLinkingResponse')),
    createDeepLinkingHtmlResponse: (_contentItems: DeepLinkingContentItem[]) =>
      Promise.resolve(unavailable('deep_linking', 'createDeepLinkingHtmlResponse')),
    ...overrides,
  };
}

function unavailable<T>(
  serviceKind: LtiServiceKind,
  operation: string,
): LtiServiceResult<T> {
  return {
    success: false,
    error: createTestServiceError({
      code: 'service_not_available',
      serviceKind,
      operation,
      message: `${serviceKind} is not available in this fake Advantage client`,
    }),
  };
}
