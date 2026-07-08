import { generateKeyPair } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_LINEITEM_READONLY,
  LTI_AGS_SCOPE_RESULT_READONLY,
  LTI_AGS_SCOPE_SCORE,
  LTITool,
  type LTILaunchConfig,
  type LTIStorage,
  type LTISession,
} from '../src/index.js';
import type { CreateLineItem } from '../src/schemas/lti13/ags/lineItem.schema.js';
import type { ScoreSubmission } from '../src/schemas/lti13/ags/scoreSubmission.schema.js';

const launchConfig: LTILaunchConfig = {
  iss: 'https://platform.example.com',
  clientId: 'client123',
  deploymentId: 'deployment123',
  authUrl: 'https://platform.example.com/auth',
  tokenUrl: 'https://platform.example.com/token',
  jwksUrl: 'https://platform.example.com/jwks',
};

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
    getLaunchConfig: vi.fn().mockResolvedValue(launchConfig),
    saveLaunchConfig: vi.fn(),
    deleteRegistrationSession: vi.fn(),
    getRegistrationSession: vi.fn(),
    setRegistrationSession: vi.fn(),
  }) as unknown as LTIStorage;

const session = {
  id: 'session-1',
  platform: {
    issuer: launchConfig.iss,
    clientId: launchConfig.clientId,
    deploymentId: launchConfig.deploymentId,
  },
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

const createLineItem = {
  label: 'Quiz 1',
  scoreMaximum: 10,
} satisfies CreateLineItem;

const results = [
  {
    id: 'https://platform.example.com/ags/lineitems/1/results/user-1',
    scoreOf: 'https://platform.example.com/ags/lineitems/1',
    userId: 'user-1',
    resultScore: 9,
    resultMaximum: 10,
  },
];

type RecordedFetchRequest = {
  readonly url: string;
  readonly init?: RequestInit;
};

const tokenResponse = (): Response => Response.json({ access_token: 'access-token' });

const recordFetch = (responses: Response[]): RecordedFetchRequest[] => {
  const requests: RecordedFetchRequest[] = [];
  globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      init,
    });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected fetch call');
    return Promise.resolve(response);
  });

  return requests;
};

describe('LTI service results', () => {
  let keyPair: CryptoKeyPair;
  let ltiTool: LTITool;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    keyPair = await generateKeyPair('RS256');
    originalFetch = globalThis.fetch;
  });

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    ltiTool = new LTITool({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage: createMockStorage(),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns structured success for AGS score submission', async () => {
    const response = new Response(null, { status: 204 });
    const requests = recordFetch([tokenResponse(), response]);
    const advantage = ltiTool.createAdvantage(session);

    const result = await advantage.submitScore(score);

    expect(result).toEqual({
      success: true,
      data: undefined,
      response,
    });
    expect(requests[1]?.url).toBe('https://platform.example.com/ags/lineitems/1/scores');
  });

  it('returns a missing scope error before AGS score submission', async () => {
    const advantage = ltiTool.createAdvantage({
      ...session,
      services: {
        ags: {
          lineitem: 'https://platform.example.com/ags/lineitems/1',
          scopes: [],
        },
      },
    } as LTISession);
    const result = await advantage.submitScore(score);

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
    recordFetch([
      Response.json(
        { error: 'invalid_client' },
        { status: 401, statusText: 'Unauthorized' },
      ),
    ]);
    const advantage = ltiTool.createAdvantage(session);

    const result = await advantage.submitScore(score);

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
    const requests = recordFetch([tokenResponse(), response]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.listLineItems({
      resourceId: 'quiz-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual([lineItem]);
    expect(result.response).toBe(response);
    expect(requests[1]?.url).toBe(
      'https://platform.example.com/ags/lineitems?resource_id=quiz-1',
    );
  });

  it('returns structured success for AGS score retrieval', async () => {
    const response = Response.json(results);
    const requests = recordFetch([tokenResponse(), response]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.getScores();

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected service success');
    expect(result.data).toEqual(results);
    expect(result.response).toBe(response);
    expect(requests[1]?.url).toBe('https://platform.example.com/ags/lineitems/1/results');
  });

  it('returns structured success for AGS line item retrieval', async () => {
    const response = Response.json(lineItem);
    const requests = recordFetch([tokenResponse(), response]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.getLineItem({
      lineItemUrl: 'https://platform.example.com/ags/lineitems/1',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual(lineItem);
    expect(result.response).toBe(response);
    expect(requests[1]?.url).toBe('https://platform.example.com/ags/lineitems/1');
  });

  it('returns structured success for AGS line item creation', async () => {
    const response = Response.json(lineItem);
    const requests = recordFetch([tokenResponse(), response]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.createLineItem(createLineItem);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected detailed service success');
    expect(result.data).toEqual(lineItem);
    expect(result.response).toBe(response);
    expect(requests[1]?.url).toBe('https://platform.example.com/ags/lineitems');
  });

  it('returns structured success for AGS line item update', async () => {
    const response = Response.json(lineItem);
    recordFetch([tokenResponse(), response]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.updateLineItem({
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
    recordFetch([tokenResponse(), response]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.deleteLineItem();

    expect(result).toEqual({
      success: true,
      data: undefined,
      response,
    });
  });

  it('returns a missing scope error before AGS line item listing', async () => {
    const advantage = ltiTool.createAdvantage({
      ...lineItemsSession,
      services: {
        ags: {
          lineitems: 'https://platform.example.com/ags/lineitems',
          scopes: [],
        },
      },
    } as LTISession);
    const result = await advantage.listLineItems();

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
    recordFetch([tokenResponse(), Response.json({ label: 'Quiz 1' })]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.getLineItem();

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      code: 'platform_response_invalid',
      serviceKind: 'ags',
      operation: 'getLineItem',
    });
  });

  it('returns a missing scope error before AGS score retrieval', async () => {
    const advantage = ltiTool.createAdvantage({
      ...lineItemsSession,
      services: {
        ags: {
          lineitem: 'https://platform.example.com/ags/lineitems/1',
          scopes: [],
        },
      },
    } as LTISession);
    const result = await advantage.getScores();

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected service failure');
    expect(result.error).toMatchObject({
      code: 'missing_required_scope',
      serviceKind: 'ags',
      operation: 'getScores',
    });
  });

  it('classifies invalid AGS score platform responses', async () => {
    recordFetch([tokenResponse(), Response.json({ resultScore: 9 })]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.getScores();

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected service failure');
    expect(result.error).toMatchObject({
      code: 'platform_response_invalid',
      serviceKind: 'ags',
      operation: 'getScores',
    });
  });

  it('classifies AGS line item service failures', async () => {
    recordFetch([
      tokenResponse(),
      new Response('upstream unavailable', { status: 502, statusText: 'Bad Gateway' }),
    ]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.createLineItem(createLineItem);

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
    recordFetch([
      tokenResponse(),
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
    ]);
    const advantage = ltiTool.createAdvantage(session);

    const result = await advantage.getMembers();

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
    recordFetch([tokenResponse(), Response.json({ members: [{}] })]);
    const advantage = ltiTool.createAdvantage(session);

    const result = await advantage.getMembers();

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected detailed service failure');
    expect(result.error).toMatchObject({
      code: 'platform_response_invalid',
      serviceKind: 'nrps',
      operation: 'getMembers',
    });
  });

  it('returns one NRPS page with parsed Link headers', async () => {
    const response = Response.json(
      {
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
      },
      {
        headers: {
          Link: '<https://platform.example.com/nrps/page-2>; rel="next", <https://platform.example.com/nrps/diff>; rel="differences"',
        },
      },
    );
    recordFetch([tokenResponse(), response]);
    const advantage = ltiTool.createAdvantage(session);

    const result = await advantage.getMembersPage();

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected NRPS page success');
    expect(result.data.members).toEqual([
      {
        status: 'Active',
        name: 'Ada Lovelace',
        userId: 'user-1',
        roles: [],
      },
    ]);
    expect(result.data.nextUrl).toBe('https://platform.example.com/nrps/page-2');
    expect(result.data.differencesUrl).toBe('https://platform.example.com/nrps/diff');
  });

  it('follows NRPS pagination when requested', async () => {
    const pageOne = Response.json(
      {
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
      },
      {
        headers: {
          Link: '<https://platform.example.com/nrps/page-2>; rel="next"',
        },
      },
    );
    const pageTwo = Response.json({
      id: 'https://platform.example.com/nrps/page-2',
      context: { id: 'course-1' },
      members: [
        {
          status: 'Active',
          name: 'Grace Hopper',
          user_id: 'user-2',
          roles: [],
        },
      ],
    });
    const requests = recordFetch([tokenResponse(), pageOne, tokenResponse(), pageTwo]);
    const advantage = ltiTool.createAdvantage(session);

    const result = await advantage.getMembers({ followPagination: true });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected paginated NRPS success');
    expect(result.data.members).toEqual([
      {
        status: 'Active',
        name: 'Ada Lovelace',
        userId: 'user-1',
        roles: [],
      },
      {
        status: 'Active',
        name: 'Grace Hopper',
        userId: 'user-2',
        roles: [],
      },
    ]);
    expect(result.data.pagination).toEqual({
      pagesFetched: 2,
      truncated: false,
    });
    expect(
      requests.some(
        (request) => request.url === 'https://platform.example.com/nrps/page-2',
      ),
    ).toBe(true);
  });

  it('reports NRPS truncation when maxPages is reached', async () => {
    const pageOne = Response.json(
      {
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
      },
      {
        headers: {
          Link: '<https://platform.example.com/nrps/page-2>; rel="next"',
        },
      },
    );
    recordFetch([tokenResponse(), pageOne]);
    const advantage = ltiTool.createAdvantage(session);

    const result = await advantage.getMembers({ followPagination: true, maxPages: 1 });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected truncated NRPS success');
    expect(result.data.members).toHaveLength(1);
    expect(result.data.pagination).toEqual({
      pagesFetched: 1,
      truncated: true,
      nextUrl: 'https://platform.example.com/nrps/page-2',
    });
  });

  it('rejects invalid NRPS pagination limits', async () => {
    const advantage = ltiTool.createAdvantage(session);

    const result = await advantage.getMembers({ followPagination: true, maxPages: 0 });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected invalid pagination failure');
    expect(result.error).toMatchObject({
      code: 'invalid_request',
      serviceKind: 'nrps',
      operation: 'getMembers',
      message: 'maxPages must be a positive integer',
    });
  });

  it('returns an existing AGS line item from findOrCreateLineItem', async () => {
    const existingLineItem = {
      ...lineItem,
      resourceLinkId: 'resource-link-1',
      tag: 'quiz',
    };
    recordFetch([tokenResponse(), Response.json([existingLineItem])]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.findOrCreateLineItem({
      resourceLinkId: 'resource-link-1',
      tag: 'quiz',
      create: createLineItem,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected findOrCreate success');
    expect(result.data).toEqual(existingLineItem);
  });

  it('creates an AGS line item when findOrCreateLineItem finds no match', async () => {
    const createdLineItem = {
      ...lineItem,
      id: 'https://platform.example.com/ags/lineitems/2',
      resourceLinkId: 'resource-link-1',
      tag: 'quiz',
    };
    recordFetch([
      tokenResponse(),
      Response.json([]),
      tokenResponse(),
      Response.json(createdLineItem),
    ]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.findOrCreateLineItem({
      resourceLinkId: 'resource-link-1',
      tag: 'quiz',
      create: createLineItem,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected findOrCreate create success');
    expect(result.data).toEqual(createdLineItem);
  });

  it('rejects findOrCreateLineItem without identity keys', async () => {
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    // @ts-expect-error Runtime precondition protects untyped callers.
    const result = await advantage.findOrCreateLineItem({
      create: createLineItem,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected findOrCreate validation failure');
    expect(result.error).toMatchObject({
      code: 'invalid_request',
      serviceKind: 'ags',
      operation: 'findOrCreateLineItem',
    });
  });

  it('rejects line item identity fields nested in findOrCreateLineItem create input', async () => {
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.findOrCreateLineItem({
      resourceLinkId: 'resource-link-1',
      create: {
        label: 'Quiz 1',
        scoreMaximum: 10,
        // @ts-expect-error Runtime precondition protects untyped callers.
        resourceLinkId: 'nested-resource-link',
      },
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected findOrCreate validation failure');
    expect(result.error).toMatchObject({
      code: 'invalid_request',
      serviceKind: 'ags',
      operation: 'findOrCreateLineItem',
      message: 'Line item identity fields must be supplied at the top level',
    });
  });

  it('recovers from AGS create races in findOrCreateLineItem', async () => {
    const existingLineItem = {
      ...lineItem,
      id: 'https://platform.example.com/ags/lineitems/2',
      resourceLinkId: 'resource-link-1',
    };
    recordFetch([
      tokenResponse(),
      Response.json([]),
      tokenResponse(),
      new Response('conflict', { status: 409, statusText: 'Conflict' }),
      tokenResponse(),
      Response.json([existingLineItem]),
    ]);
    const advantage = ltiTool.createAdvantage(lineItemsSession);

    const result = await advantage.findOrCreateLineItem({
      resourceLinkId: 'resource-link-1',
      create: createLineItem,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected findOrCreate race recovery');
    expect(result.data).toEqual(existingLineItem);
  });

  it('creates no-store html responses for deep linking returns', async () => {
    const advantage = ltiTool.createAdvantage({
      ...session,
      services: {
        ...session.services,
        deepLinking: {
          returnUrl: 'https://platform.example.com/deep-link-return',
          acceptTypes: ['ltiResourceLink'],
          acceptPresentationDocumentTargets: [],
          acceptMultiple: false,
          autoCreate: false,
        },
      },
    });

    const result = await advantage.createDeepLinkingHtmlResponse([
      {
        type: 'ltiResourceLink',
        title: 'Badge',
        url: 'https://tool.example.com/badges/1',
      },
    ]);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected deep linking response');
    expect(result.data.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(result.data.headers.get('cache-control')).toBe('no-store');
    expect(await result.data.text()).toContain('deepLinkingForm');
  });
});
