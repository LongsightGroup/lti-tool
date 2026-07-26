import { generateKeyPair } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { testRegistrationSession } from '#test-harness/fixtures';

import {
  LTI_CLAIM_TOOL_CONFIGURATION,
  LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
  LtiDynamicRegistration,
  LtiStorageConflictError,
  type LTILaunchConfig,
  type LTIStorage,
} from '../src/index.js';
import type { DynamicRegistrationForm } from '../src/schemas/lti13/dynamicRegistration/ltiDynamicRegistration.schema.js';
import type { RegistrationRequest } from '../src/schemas/lti13/dynamicRegistration/registrationRequest.schema.js';

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
    consumeRegistrationSession: vi.fn(),
    setRegistrationSession: vi.fn(),
  }) as unknown as LTIStorage;

const createRegistrationResponse = (clientId: string) => ({
  client_id: clientId,
  application_type: 'web',
  response_types: ['id_token'],
  grant_types: ['implicit', 'client_credentials'],
  initiate_login_uri: 'https://tool.example.com/lti/login',
  redirect_uris: ['https://tool.example.com', 'https://tool.example.com/lti/launch'],
  client_name: 'Test Tool',
  jwks_uri: 'https://tool.example.com/lti/jwks',
  token_endpoint_auth_method: 'private_key_jwt',
  [LTI_CLAIM_TOOL_CONFIGURATION]: {
    domain: 'tool.example.com',
    target_link_uri: 'https://tool.example.com',
    claims: ['iss', 'sub', 'name', 'email'],
    messages: [{ type: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST }],
  },
});

const recordFetch = (responses: Response[]): void => {
  globalThis.fetch = vi.fn(() => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected fetch call');
    return Promise.resolve(response);
  });
};

describe('dynamic registration service errors', () => {
  let keyPair: CryptoKeyPair;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    keyPair = await generateKeyPair('RS256');
    originalFetch = globalThis.fetch;
  });

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('classifies expired dynamic registration sessions', async () => {
    const storage = createMockStorage();
    const dynamicRegistration = new LtiDynamicRegistration({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage,
      dynamicRegistration: {
        url: 'https://tool.example.com',
        name: 'Test Tool',
      },
    });

    const result = await dynamicRegistration.completeDynamicRegistration({
      sessionToken: 'expired-session-token',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected service failure');
    expect(result.error).toMatchObject({
      code: 'registration_session_expired',
      serviceKind: 'dynamic_registration',
      operation: 'completeDynamicRegistration',
    });
  });

  it('classifies platform dynamic registration rejections', async () => {
    const storage = createMockStorage();
    vi.mocked(storage.consumeRegistrationSession).mockResolvedValue(
      testRegistrationSession(),
    );
    recordFetch([Response.json({ error: 'denied' }, { status: 400 })]);
    const dynamicRegistration = new LtiDynamicRegistration({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage,
      dynamicRegistration: {
        url: 'https://tool.example.com',
        name: 'Test Tool',
      },
    });

    const result = await dynamicRegistration.completeDynamicRegistration({
      sessionToken: 'session-token-123',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected service failure');
    expect(result.error).toMatchObject({
      code: 'platform_registration_rejected',
      serviceKind: 'dynamic_registration',
      operation: 'completeDynamicRegistration',
      status: 400,
      responseBodySummary: '{"error":"denied"}',
    });
  });

  it('classifies canonical storage conflicts during dynamic registration', async () => {
    const storage = createMockStorage();
    vi.mocked(storage.consumeRegistrationSession).mockResolvedValue(
      testRegistrationSession(),
    );
    vi.mocked(storage.listClients).mockRejectedValue(
      new LtiStorageConflictError({
        operation: 'listClients',
        message: 'launch registration conflict',
      }),
    );
    recordFetch([Response.json(createRegistrationResponse('registered-client-id'))]);
    const dynamicRegistration = new LtiDynamicRegistration({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage,
      dynamicRegistration: {
        url: 'https://tool.example.com',
        name: 'Test Tool',
      },
    });

    const result = await dynamicRegistration.completeDynamicRegistration({
      sessionToken: 'session-token-123',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected service failure');
    expect(result.error).toMatchObject({
      code: 'storage_conflict',
      serviceKind: 'dynamic_registration',
      operation: 'completeDynamicRegistration',
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

    const dynamicRegistration = new LtiDynamicRegistration({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage: createMockStorage(),
    });

    const fetchResult =
      await dynamicRegistration.fetchPlatformConfiguration(registrationRequest);
    const initiateResult = await dynamicRegistration.initiateDynamicRegistration(
      registrationRequest,
      '/lti/register',
    );
    const completeResult =
      await dynamicRegistration.completeDynamicRegistration(registrationForm);

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
