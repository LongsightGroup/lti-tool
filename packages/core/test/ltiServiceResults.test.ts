import { generateKeyPair } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_LINEITEM_READONLY,
  LTI_AGS_SCOPE_SCORE,
  LtiServiceError,
  LTITool,
  type LTIStorage,
  type LTISession,
} from '../src/index.js';
import type { CreateLineItem } from '../src/schemas/lti13/ags/lineItem.schema.js';
import type { ScoreSubmission } from '../src/schemas/lti13/ags/scoreSubmission.schema.js';

const createMockStorage = (): LTIStorage =>
  ({
    listClients: vi.fn(),
    getClientById: vi.fn(),
    addClient: vi.fn(),
    updateClient: vi.fn(),
    deleteClient: vi.fn(),
    listDeployments: vi.fn(),
    getDeployment: vi.fn(),
    addDeployment: vi.fn(),
    updateDeployment: vi.fn(),
    deleteDeployment: vi.fn(),
    getSession: vi.fn(),
    addSession: vi.fn(),
    storeNonce: vi.fn(),
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

describe('LTI detailed service results', () => {
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
    (
      ltiTool as unknown as {
        agsService: { submitScore: ReturnType<typeof vi.fn> };
      }
    ).agsService = {
      submitScore: vi.fn().mockResolvedValue(response),
    };

    const result = await ltiTool.submitScoreDetailed(session, score);

    expect(result).toEqual({
      success: true,
      data: undefined,
      response,
    });
  });

  it('returns a missing scope error before AGS score submission', async () => {
    const result = await ltiTool.submitScoreDetailed(
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
    (
      ltiTool as unknown as {
        agsService: { submitScore: ReturnType<typeof vi.fn> };
      }
    ).agsService = {
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
    };

    const result = await ltiTool.submitScoreDetailed(session, score);

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
    (
      ltiTool as unknown as {
        agsService: { listLineItems: typeof listLineItems };
      }
    ).agsService = { listLineItems };

    const result = await ltiTool.listLineItemsDetailed(lineItemsSession, {
      resourceId: 'quiz-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual([lineItem]);
    expect(result.response).toBe(response);
    expect(listLineItems).toHaveBeenCalledWith(lineItemsSession, {
      resourceId: 'quiz-1',
    });
  });

  it('returns structured success for AGS line item retrieval', async () => {
    const response = Response.json(lineItem);
    const getLineItem = vi.fn().mockResolvedValue(response);
    (
      ltiTool as unknown as {
        agsService: { getLineItem: typeof getLineItem };
      }
    ).agsService = { getLineItem };

    const result = await ltiTool.getLineItemDetailed(lineItemsSession, {
      lineItemUrl: 'https://platform.example.com/ags/lineitems/1',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual(lineItem);
    expect(result.response).toBe(response);
    expect(getLineItem).toHaveBeenCalledWith(lineItemsSession, {
      lineItemUrl: 'https://platform.example.com/ags/lineitems/1',
    });
  });

  it('returns structured success for AGS line item creation', async () => {
    const response = Response.json(lineItem);
    const createLineItemMock = vi.fn().mockResolvedValue(response);
    (
      ltiTool as unknown as {
        agsService: { createLineItem: typeof createLineItemMock };
      }
    ).agsService = { createLineItem: createLineItemMock };

    const result = await ltiTool.createLineItemDetailed(lineItemsSession, createLineItem);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual(lineItem);
    expect(result.response).toBe(response);
    expect(createLineItemMock).toHaveBeenCalledWith(lineItemsSession, createLineItem);
  });

  it('returns a missing scope error before AGS line item listing', async () => {
    const result = await ltiTool.listLineItemsDetailed({
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
    (
      ltiTool as unknown as {
        agsService: { getLineItem: ReturnType<typeof vi.fn> };
      }
    ).agsService = {
      getLineItem: vi.fn().mockResolvedValue(Response.json({ label: 'Quiz 1' })),
    };

    const result = await ltiTool.getLineItemDetailed(lineItemsSession);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      code: 'platform_response_invalid',
      serviceKind: 'ags',
      operation: 'getLineItem',
    });
  });

  it('classifies AGS line item service failures', async () => {
    (
      ltiTool as unknown as {
        agsService: { createLineItem: ReturnType<typeof vi.fn> };
      }
    ).agsService = {
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
    };

    const result = await ltiTool.createLineItemDetailed(lineItemsSession, createLineItem);

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
    (
      ltiTool as unknown as {
        nrpsService: { getMembers: ReturnType<typeof vi.fn> };
      }
    ).nrpsService = {
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
    };

    const result = await ltiTool.getMembersDetailed(session);

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
    (
      ltiTool as unknown as {
        nrpsService: { getMembers: ReturnType<typeof vi.fn> };
      }
    ).nrpsService = {
      getMembers: vi.fn().mockResolvedValue(Response.json({ members: [{}] })),
    };

    const result = await ltiTool.getMembersDetailed(session);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      code: 'platform_response_invalid',
      serviceKind: 'nrps',
      operation: 'getMembers',
    });
  });
});
