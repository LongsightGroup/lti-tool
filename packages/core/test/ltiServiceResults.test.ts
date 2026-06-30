import { generateKeyPair } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_LINEITEM_READONLY,
  LTI_AGS_SCOPE_RESULT_READONLY,
  LTI_AGS_SCOPE_SCORE,
  LtiServiceError,
  LTITool,
  type LTIStorage,
  type LTISession,
} from '../src/index.js';
import type { CreateLineItem } from '../src/schemas/lti13/ags/lineItem.schema.js';
import type { ScoreSubmission } from '../src/schemas/lti13/ags/scoreSubmission.schema.js';
import type { DynamicRegistrationForm } from '../src/schemas/lti13/dynamicRegistration/ltiDynamicRegistration.schema.js';
import type { RegistrationRequest } from '../src/schemas/lti13/dynamicRegistration/registrationRequest.schema.js';

const createMockStorage = (): LTIStorage =>
  ({
    listClients: vi.fn(),
    getClientById: vi.fn(),
    addClient: vi.fn(),
    updateClient: vi.fn(),
    deleteClient: vi.fn(),
    listDeployments: vi.fn(),
    getDeploymentByPlatformId: vi.fn(),
    addDeployment: vi.fn(),
    updateDeploymentById: vi.fn(),
    deleteDeploymentById: vi.fn(),
    getSession: vi.fn(),
    addSession: vi.fn(),
    validateNonce: vi.fn(),
    getLaunchConfig: vi.fn(),
    saveLaunchConfig: vi.fn(),
    deleteRegistrationSession: vi.fn(),
    getRegistrationSession: vi.fn(),
    setRegistrationSession: vi.fn(),
  }) as unknown as LTIStorage;

const session = {
  id: 'session-1',
  services: {
    ags: {
      lineitem: 'https://platform.example.com/ags/lineitems/1',
      scopes: [LTI_AGS_SCOPE_SCORE],
    },
    nrps: {
      membershipUrl: 'https://platform.example.com/nrps/members',
      versions: ['2.0'],
    },
  },
} as LTISession;

const lineItemsSession = {
  ...session,
  services: {
    ...session.services,
    ags: {
      lineitem: 'https://platform.example.com/ags/lineitems/1',
      lineitems: 'https://platform.example.com/ags/lineitems',
      scopes: [
        LTI_AGS_SCOPE_LINEITEM,
        LTI_AGS_SCOPE_LINEITEM_READONLY,
        LTI_AGS_SCOPE_RESULT_READONLY,
        LTI_AGS_SCOPE_SCORE,
      ],
    },
  },
} as LTISession;

const score: ScoreSubmission = {
  scoreGiven: 9,
  scoreMaximum: 10,
  activityProgress: 'Completed',
  gradingProgress: 'FullyGraded',
};

const lineItem = {
  id: 'https://platform.example.com/ags/lineitems/1',
  label: 'Quiz 1',
  scoreMaximum: 10,
};

const createLineItem: CreateLineItem = {
  label: 'Quiz 1',
  scoreMaximum: 10,
};

const results = [
  {
    id: 'https://platform.example.com/ags/lineitems/1/results/user-1',
    scoreOf: 'https://platform.example.com/ags/lineitems/1',
    userId: 'user-1',
    resultScore: 9,
    resultMaximum: 10,
  },
];

const replaceAgsService = (ltiTool: LTITool, agsService: unknown): void => {
  (
    ltiTool as unknown as {
      platformServices: { agsService: unknown };
    }
  ).platformServices.agsService = agsService;
};

const replaceNrpsService = (ltiTool: LTITool, nrpsService: unknown): void => {
  (
    ltiTool as unknown as {
      platformServices: { nrpsService: unknown };
    }
  ).platformServices.nrpsService = nrpsService;
};

describe('LTI service results', () => {
  let keyPair: CryptoKeyPair;
  let ltiTool: LTITool;

  beforeAll(async () => {
    keyPair = await generateKeyPair('RS256');
  });

  beforeEach(() => {
    ltiTool = new LTITool({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage: createMockStorage(),
    });
  });

  it('returns structured success for AGS score submission', async () => {
    const response = new Response(null, { status: 204 });
    replaceAgsService(ltiTool, {
      submitScore: vi.fn().mockResolvedValue(response),
    });

    const result = await ltiTool.submitScore(session, score);

    expect(result).toEqual({
      success: true,
      data: undefined,
      response,
    });
  });

  it('returns a missing scope error before AGS score submission', async () => {
    const result = await ltiTool.submitScore(
      {
        ...session,
        services: {
          ags: {
            lineitem: 'https://platform.example.com/ags/lineitems/1',
            scopes: [],
          },
        },
      } as LTISession,
      score,
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      name: 'LtiServiceError',
      code: 'missing_required_scope',
      serviceKind: 'ags',
      operation: 'submitScore',
    });
  });

  it('classifies token failures from service calls', async () => {
    replaceAgsService(ltiTool, {
      submitScore: vi.fn().mockRejectedValue(
        new LtiServiceError({
          code: 'token_request_failed',
          serviceKind: 'token',
          operation: 'getBearerToken',
          message: 'Token request failed: 401 Unauthorized',
          endpointType: 'token',
          status: 401,
          statusText: 'Unauthorized',
          responseBodySummary: '{"error":"invalid_client"}',
        }),
      ),
    });

    const result = await ltiTool.submitScore(session, score);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      code: 'token_request_failed',
      serviceKind: 'ags',
      operation: 'submitScore',
      endpointType: 'token',
      status: 401,
      responseBodySummary: '{"error":"invalid_client"}',
    });
  });

  it('returns structured success for AGS line item listing', async () => {
    const response = Response.json([lineItem]);
    const listLineItems = vi.fn().mockResolvedValue(response);
    replaceAgsService(ltiTool, { listLineItems });

    const result = await ltiTool.listLineItems(lineItemsSession, {
      resourceId: 'quiz-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual([lineItem]);
    expect(result.response).toBe(response);
    expect(listLineItems).toHaveBeenCalledWith(
      lineItemsSession,
      'https://platform.example.com/ags/lineitems',
      {
        resourceId: 'quiz-1',
      },
    );
  });

  it('returns structured success for AGS score retrieval', async () => {
    const response = Response.json(results);
    const getScores = vi.fn().mockResolvedValue(response);
    replaceAgsService(ltiTool, { getScores });

    const result = await ltiTool.getScores(lineItemsSession);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected service success');
    expect(result.data).toEqual(results);
    expect(result.response).toBe(response);
    expect(getScores).toHaveBeenCalledWith(
      lineItemsSession,
      'https://platform.example.com/ags/lineitems/1',
      {},
    );
  });

  it('returns structured success for AGS line item retrieval', async () => {
    const response = Response.json(lineItem);
    const getLineItem = vi.fn().mockResolvedValue(response);
    replaceAgsService(ltiTool, { getLineItem });

    const result = await ltiTool.getLineItem(lineItemsSession, {
      lineItemUrl: 'https://platform.example.com/ags/lineitems/1',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual(lineItem);
    expect(result.response).toBe(response);
    expect(getLineItem).toHaveBeenCalledWith(
      lineItemsSession,
      'https://platform.example.com/ags/lineitems/1',
    );
  });

  it('returns structured success for AGS line item creation', async () => {
    const response = Response.json(lineItem);
    const createLineItemMock = vi.fn().mockResolvedValue(response);
    replaceAgsService(ltiTool, { createLineItem: createLineItemMock });

    const result = await ltiTool.createLineItem(lineItemsSession, createLineItem);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual(lineItem);
    expect(result.response).toBe(response);
    expect(createLineItemMock).toHaveBeenCalledWith(
      lineItemsSession,
      'https://platform.example.com/ags/lineitems',
      createLineItem,
    );
  });

  it('returns structured success for AGS line item update', async () => {
    const response = Response.json(lineItem);
    const updateLineItem = vi.fn().mockResolvedValue(response);
    replaceAgsService(ltiTool, { updateLineItem });

    const result = await ltiTool.updateLineItem(lineItemsSession, {
      label: 'Quiz 1',
      scoreMaximum: 10,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected service success');
    expect(result.data).toEqual(lineItem);
    expect(result.response).toBe(response);
  });

  it('returns structured success for AGS line item deletion', async () => {
    const response = new Response(null, { status: 204 });
    const deleteLineItem = vi.fn().mockResolvedValue(response);
    replaceAgsService(ltiTool, { deleteLineItem });

    const result = await ltiTool.deleteLineItem(lineItemsSession);

    expect(result).toEqual({
      success: true,
      data: undefined,
      response,
    });
  });

  it('returns a missing scope error before AGS line item listing', async () => {
    const result = await ltiTool.listLineItems({
      ...lineItemsSession,
      services: {
        ags: {
          lineitems: 'https://platform.example.com/ags/lineitems',
          scopes: [],
        },
      },
    } as LTISession);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      name: 'LtiServiceError',
      code: 'missing_required_scope',
      serviceKind: 'ags',
      operation: 'listLineItems',
    });
  });

  it('classifies invalid AGS line item platform responses', async () => {
    replaceAgsService(ltiTool, {
      getLineItem: vi.fn().mockResolvedValue(Response.json({ label: 'Quiz 1' })),
    });

    const result = await ltiTool.getLineItem(lineItemsSession);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      code: 'platform_response_invalid',
      serviceKind: 'ags',
      operation: 'getLineItem',
    });
  });

  it('returns a missing scope error before AGS score retrieval', async () => {
    const result = await ltiTool.getScores({
      ...lineItemsSession,
      services: {
        ags: {
          lineitem: 'https://platform.example.com/ags/lineitems/1',
          scopes: [],
        },
      },
    } as LTISession);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected service failure');
    expect(result.error).toMatchObject({
      code: 'missing_required_scope',
      serviceKind: 'ags',
      operation: 'getScores',
    });
  });

  it('classifies invalid AGS score platform responses', async () => {
    replaceAgsService(ltiTool, {
      getScores: vi.fn().mockResolvedValue(Response.json({ resultScore: 9 })),
    });

    const result = await ltiTool.getScores(lineItemsSession);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected service failure');
    expect(result.error).toMatchObject({
      code: 'platform_response_invalid',
      serviceKind: 'ags',
      operation: 'getScores',
    });
  });

  it('classifies AGS line item service failures', async () => {
    replaceAgsService(ltiTool, {
      createLineItem: vi.fn().mockRejectedValue(
        new LtiServiceError({
          code: 'platform_request_failed',
          serviceKind: 'ags',
          operation: 'createLineItem',
          message: 'AGS create line item failed: 502 Bad Gateway',
          endpointType: 'ags',
          status: 502,
          statusText: 'Bad Gateway',
          responseBodySummary: 'upstream unavailable',
        }),
      ),
    });

    const result = await ltiTool.createLineItem(lineItemsSession, createLineItem);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      code: 'platform_request_failed',
      serviceKind: 'ags',
      operation: 'createLineItem',
      endpointType: 'ags',
      status: 502,
      responseBodySummary: 'upstream unavailable',
    });
  });

  it('returns normalized NRPS members on success', async () => {
    replaceNrpsService(ltiTool, {
      getMembers: vi.fn().mockResolvedValue(
        Response.json({
          id: 'https://platform.example.com/nrps/members',
          context: { id: 'course-1' },
          members: [
            {
              status: 'Active',
              name: 'Ada Lovelace',
              user_id: 'user-1',
              roles: [],
            },
          ],
        }),
      ),
    });

    const result = await ltiTool.getMembers(session);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual([
      {
        status: 'Active',
        name: 'Ada Lovelace',
        userId: 'user-1',
        roles: [],
      },
    ]);
  });

  it('classifies invalid NRPS platform responses', async () => {
    replaceNrpsService(ltiTool, {
      getMembers: vi.fn().mockResolvedValue(Response.json({ members: [{}] })),
    });

    const result = await ltiTool.getMembers(session);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      code: 'platform_response_invalid',
      serviceKind: 'nrps',
      operation: 'getMembers',
    });
  });

  it('returns structured failures when dynamic registration is not configured', async () => {
    const registrationRequest: RegistrationRequest = {
      openid_configuration:
        'https://platform.example.com/.well-known/openid-configuration',
    };
    const registrationForm: DynamicRegistrationForm = {
      sessionToken: 'session-token-123',
    };

    const fetchResult = await ltiTool.fetchPlatformConfiguration(registrationRequest);
    const initiateResult = await ltiTool.initiateDynamicRegistration(
      registrationRequest,
      '/lti/register',
    );
    const completeResult = await ltiTool.completeDynamicRegistration(registrationForm);

    expect(fetchResult.success).toBe(false);
    if (fetchResult.success) throw new Error('Expected service failure');
    expect(fetchResult.error).toMatchObject({
      code: 'service_not_available',
      serviceKind: 'dynamic_registration',
      operation: 'fetchPlatformConfiguration',
    });

    expect(initiateResult.success).toBe(false);
    if (initiateResult.success) throw new Error('Expected service failure');
    expect(initiateResult.error).toMatchObject({
      code: 'service_not_available',
      serviceKind: 'dynamic_registration',
      operation: 'initiateDynamicRegistration',
    });

    expect(completeResult.success).toBe(false);
    if (completeResult.success) throw new Error('Expected service failure');
    expect(completeResult.error).toMatchObject({
      code: 'service_not_available',
      serviceKind: 'dynamic_registration',
      operation: 'completeDynamicRegistration',
    });
  });
});
