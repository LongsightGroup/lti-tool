import { generateKeyPair } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LTI_AGS_SCOPE_SCORE,
  LtiServiceError,
  LTITool,
  type LTIStorage,
  type LTISession,
} from '../src/index.js';
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

const score: ScoreSubmission = {
  scoreGiven: 9,
  scoreMaximum: 10,
  activityProgress: 'Completed',
  gradingProgress: 'FullyGraded',
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
