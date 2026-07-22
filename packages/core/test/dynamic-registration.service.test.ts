import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LTI_CLAIM_PLATFORM_CONFIGURATION,
  LTI_CLAIM_TOOL_CONFIGURATION,
  LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
  LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
} from '../src/constants.js';
import type {
  DynamicRegistrationConfig,
  LTIDynamicRegistrationSession,
  LtiLogger,
  LTIStorage,
} from '../src/index.js';
import type { DynamicRegistrationForm } from '../src/schemas/lti13/dynamicRegistration/ltiDynamicRegistration.schema.js';
import {
  ToolRegistrationPayloadSchema,
  type ToolRegistrationPayload,
} from '../src/schemas/lti13/dynamicRegistration/toolRegistrationPayload.schema.js';
import { DynamicRegistrationService } from '../src/services/dynamicRegistration.service.js';

const TOOL_URL = 'https://lti.local.test';
const TOOL_NAME = 'My LTI Tool';
const SESSION_TOKEN = 'session-token-123';

const createOpenIdConfiguration = ({
  productFamilyCode,
  baseUrl = 'https://platform.example',
}: {
  productFamilyCode: string;
  baseUrl?: string;
}) => ({
  issuer: baseUrl,
  authorization_endpoint: `${baseUrl}/imsoidc/lti13/oidc_auth`,
  registration_endpoint: `${baseUrl}/imsblis/lti13/registration_endpoint/1`,
  jwks_uri: `${baseUrl}/imsblis/lti13/keyset`,
  token_endpoint: `${baseUrl}/imsblis/lti13/token/1`,
  token_endpoint_auth_methods_supported: ['private_key_jwt'],
  token_endpoint_auth_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid'],
  response_types_supported: ['id_token'],
  id_token_signing_alg_values_supported: ['RS256'],
  claims_supported: ['iss', 'aud'],
  subject_types_supported: ['public', 'pairwise'],
  [LTI_CLAIM_PLATFORM_CONFIGURATION]: {
    product_family_code: productFamilyCode,
    version: '26-SNAPSHOT',
    messages_supported: [{ type: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST }],
  },
});

const createStorageMock = () =>
  ({
    listClients: vi.fn().mockResolvedValue([]),
    getClientById: vi.fn(),
    addClient: vi.fn().mockResolvedValue('client-record-id'),
    updateClient: vi.fn(),
    deleteClient: vi.fn(),
    listDeployments: vi.fn().mockResolvedValue([]),
    getDeploymentByPlatformId: vi.fn().mockResolvedValue(undefined),
    addDeployment: vi.fn().mockResolvedValue('deployment-record-id'),
    updateDeploymentById: vi.fn(),
    deleteDeploymentById: vi.fn(),
    getSession: vi.fn(),
    addSession: vi.fn(),
    validateNonce: vi.fn(),
    getLaunchConfig: vi.fn(),
    saveLaunchConfig: vi.fn(),
    setRegistrationSession: vi.fn(),
    getRegistrationSession: vi.fn(),
    deleteRegistrationSession: vi.fn(),
  }) as unknown as LTIStorage;

const createRegistrationResponse = (clientId: string) => ({
  client_id: clientId,
  application_type: 'web',
  response_types: ['id_token'],
  grant_types: ['implicit', 'client_credentials'],
  initiate_login_uri: `${TOOL_URL}/lti/login`,
  redirect_uris: [TOOL_URL, `${TOOL_URL}/lti/launch`],
  client_name: TOOL_NAME,
  jwks_uri: `${TOOL_URL}/lti/jwks`,
  token_endpoint_auth_method: 'private_key_jwt',
  scope: '',
  [LTI_CLAIM_TOOL_CONFIGURATION]: {
    domain: 'lti.local.test',
    target_link_uri: TOOL_URL,
    claims: ['iss', 'sub', 'name', 'email'],
    messages: [{ type: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST }],
  },
});

function createRegistrationResponseWithDeployment(
  clientId: string,
  deploymentId: string,
) {
  const response = createRegistrationResponse(clientId);
  return {
    ...response,
    [LTI_CLAIM_TOOL_CONFIGURATION]: {
      ...response[LTI_CLAIM_TOOL_CONFIGURATION],
      deployment_id: deploymentId,
    },
  };
}

function createLoggerMock(): LtiLogger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function createToolConfig(
  overrides: Partial<DynamicRegistrationConfig> = {},
): DynamicRegistrationConfig {
  return {
    url: TOOL_URL,
    name: TOOL_NAME,
    ...overrides,
  };
}

function createService(input: {
  storage: LTIStorage;
  config?: DynamicRegistrationConfig;
  logger?: LtiLogger;
}): DynamicRegistrationService {
  return new DynamicRegistrationService(
    input.storage,
    input.config ?? createToolConfig(),
    input.logger ?? createLoggerMock(),
  );
}

function mockJsonFetch(data: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

function parsePostedRegistrationPayload(
  body: BodyInit | null | undefined,
): ToolRegistrationPayload {
  if (typeof body !== 'string') {
    throw new Error('expected registration payload body to be a string');
  }

  return ToolRegistrationPayloadSchema.parse(JSON.parse(body));
}

type CompleteRegistrationScenario = {
  productFamilyCode: string;
  baseUrl?: string;
  config?: DynamicRegistrationConfig;
  registrationResponse?: unknown;
  services?: DynamicRegistrationForm['services'];
  session?: Partial<LTIDynamicRegistrationSession>;
};

async function completeRegistrationAndCapturePayload(
  scenario: CompleteRegistrationScenario,
): Promise<{
  fetchCall: { input: unknown; init?: RequestInit };
  requestBody: ToolRegistrationPayload;
  result: Awaited<ReturnType<DynamicRegistrationService['completeDynamicRegistration']>>;
  storage: LTIStorage;
}> {
  const storage = createStorageMock();
  const service = createService({ storage, config: scenario.config });
  const baseUrl = scenario.baseUrl ?? 'https://platform.example';
  const openIdConfiguration = createOpenIdConfiguration({
    productFamilyCode: scenario.productFamilyCode,
    baseUrl,
  });

  vi.mocked(storage.getRegistrationSession).mockResolvedValue({
    openIdConfiguration,
    registrationToken: 'reg-token-123',
    expiresAt: Date.now() + 10_000,
    ...scenario.session,
  });
  vi.mocked(storage.addClient).mockResolvedValue('client-record-id');
  vi.mocked(storage.addDeployment).mockResolvedValue('deployment-record-id');

  const fetchMock = mockJsonFetch(
    scenario.registrationResponse ??
      createRegistrationResponse(`${scenario.productFamilyCode}-client-id`),
  );

  const result = await service.completeDynamicRegistration({
    sessionToken: SESSION_TOKEN,
    services: scenario.services ?? [],
  });

  const fetchCall = fetchMock.mock.calls[0];
  if (!fetchCall) {
    throw new Error('expected registration request to be posted');
  }

  return {
    fetchCall: { input: fetchCall[0], init: fetchCall[1] },
    requestBody: parsePostedRegistrationPayload(fetchCall[1]?.body),
    result,
    storage,
  };
}

function expectedPlacementMessages(input: {
  resourceLinkPlacements: string[];
  deepLinkPlacements: string[];
}) {
  return [
    input.resourceLinkPlacements.length
      ? {
          type: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
          label: TOOL_NAME,
          target_link_uri: `${TOOL_URL}/lti/launch`,
          placements: input.resourceLinkPlacements,
        }
      : { type: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST },
    ...input.deepLinkPlacements.map((placement) => ({
      type: LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
      target_link_uri: `${TOOL_URL}/lti/deep-linking`,
      label: TOOL_NAME,
      placements: [placement],
      supported_types: ['ltiResourceLink'],
    })),
  ];
}

describe('DynamicRegistrationService', () => {
  const originalFetch = global.fetch;
  const originalRandomUUID = global.crypto.randomUUID;

  beforeEach(() => {
    global.crypto.randomUUID = vi.fn(() => SESSION_TOKEN) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    global.crypto.randomUUID = originalRandomUUID;
  });

  it('renders the generic registration page for spec-compliant platforms', async () => {
    const storage = createStorageMock();
    const service = createService({ storage });
    mockJsonFetch(
      createOpenIdConfiguration({
        productFamilyCode: 'sakailms.org',
        baseUrl: 'https://sakai.example',
      }),
    );

    const initiation = await service.initiateDynamicRegistration(
      {
        openid_configuration:
          'https://sakai.example/imsblis/lti13/well_known?key=1&clientId=abc',
        registration_token: 'reg-token-123',
      },
      '/lti/register',
    );

    expect(initiation.sessionToken).toBe(SESSION_TOKEN);
    expect(initiation.html).toContain('Configure LTI Advantage Settings');
    expect(initiation.html).not.toContain('for Sakai');
    expect(storage.setRegistrationSession).toHaveBeenCalledWith(
      SESSION_TOKEN,
      expect.objectContaining({
        registrationToken: 'reg-token-123',
      }),
    );
  });

  it('preserves the registration token when OpenID configuration redirects', async () => {
    const service = createService({ storage: createStorageMock() });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://platform.example/openid-configuration' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          createOpenIdConfiguration({
            productFamilyCode: 'canvas',
          }),
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    await service.fetchPlatformConfiguration({
      openid_configuration: 'https://platform.example/openid-configuration/start',
      registration_token: 'registration-token',
    });

    const initialRequest = fetchMock.mock.calls[0];
    if (!initialRequest) {
      throw new Error('expected initial OpenID configuration request');
    }
    const initialUrl = new URL(String(initialRequest[0]));
    const initialHeaders = new Headers(initialRequest[1]?.headers);

    expect(initialUrl.searchParams.has('registration_token')).toBe(false);
    expect(initialHeaders.get('Authorization')).toBe('Bearer registration-token');
    expect(initialRequest[1]?.redirect).toBe('manual');

    const redirectedRequest = fetchMock.mock.calls[1];
    if (!redirectedRequest) {
      throw new Error('expected OpenID configuration redirect request');
    }
    const redirectedUrl = new URL(String(redirectedRequest[0]));
    const headers = new Headers(redirectedRequest[1]?.headers);

    expect(redirectedUrl.searchParams.get('registration_token')).toBe(
      'registration-token',
    );
    expect(headers.get('Authorization')).toBe('Bearer registration-token');
    expect(headers.get('Accept')).toBe('application/json');
    expect(redirectedRequest[1]?.redirect).toBe('manual');
  });

  it('rejects cross-origin redirects before forwarding the registration token', async () => {
    const service = createService({ storage: createStorageMock() });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://attacker.example/openid-configuration' },
        }),
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(
      service.fetchPlatformConfiguration({
        openid_configuration: 'https://platform.example/openid-configuration/start',
        registration_token: 'registration-token',
      }),
    ).rejects.toMatchObject({
      code: 'platform_response_invalid',
      operation: 'fetchPlatformConfiguration',
      message:
        'Dynamic registration OpenID configuration redirect must stay on the same origin',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects redirects that downgrade OpenID configuration discovery to HTTP', async () => {
    const service = createService({ storage: createStorageMock() });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: 'http://platform.example/openid-configuration' },
        }),
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(
      service.fetchPlatformConfiguration({
        openid_configuration: 'https://platform.example/openid-configuration/start',
        registration_token: 'registration-token',
      }),
    ).rejects.toMatchObject({
      code: 'platform_response_invalid',
      operation: 'fetchPlatformConfiguration',
      message: 'Dynamic registration OpenID configuration redirect must use HTTPS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an insecure initial OpenID configuration URL before sending a token', async () => {
    const service = createService({ storage: createStorageMock() });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      service.fetchPlatformConfiguration({
        openid_configuration: 'http://platform.example/openid-configuration',
        registration_token: 'registration-token',
      }),
    ).rejects.toMatchObject({
      code: 'platform_response_invalid',
      operation: 'fetchPlatformConfiguration',
      message: 'Dynamic registration OpenID configuration URL must use HTTPS',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects OpenID configuration redirects without a location header', async () => {
    const service = createService({ storage: createStorageMock() });
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
        }),
      ),
    ) as typeof fetch;

    await expect(
      service.fetchPlatformConfiguration({
        openid_configuration: 'https://platform.example/openid-configuration/start',
      }),
    ).rejects.toMatchObject({
      code: 'platform_response_invalid',
      operation: 'fetchPlatformConfiguration',
      message: 'Dynamic registration OpenID configuration redirect is missing a location',
    });
  });

  it('rejects excessive OpenID configuration redirects', async () => {
    const service = createService({ storage: createStorageMock() });
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: '/openid-configuration/next' },
        }),
      ),
    ) as typeof fetch;

    await expect(
      service.fetchPlatformConfiguration({
        openid_configuration: 'https://platform.example/openid-configuration/start',
      }),
    ).rejects.toMatchObject({
      code: 'platform_response_invalid',
      operation: 'fetchPlatformConfiguration',
      message: 'Dynamic registration OpenID configuration redirected too many times',
    });
    expect(global.fetch).toHaveBeenCalledTimes(6);
  });

  it('reports invalid JSON OpenID configuration responses', async () => {
    const service = createService({ storage: createStorageMock() });
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response('{not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as typeof fetch;

    await expect(
      service.fetchPlatformConfiguration({
        openid_configuration: 'https://platform.example/openid-configuration',
      }),
    ).rejects.toMatchObject({
      code: 'platform_response_invalid',
      operation: 'fetchPlatformConfiguration',
      message: 'Dynamic registration OpenID configuration response is not valid JSON',
    });
  });

  it('does not include arbitrary platform JSON in request failure details', async () => {
    const service = createService({ storage: createStorageMock() });
    global.fetch = vi.fn(() =>
      Promise.resolve(
        Response.json(
          { error: 'denied', registration_token: 'platform-secret' },
          { status: 403 },
        ),
      ),
    ) as typeof fetch;

    await expect(
      service.fetchPlatformConfiguration({
        openid_configuration: 'https://platform.example/openid-configuration',
      }),
    ).rejects.toMatchObject({
      code: 'platform_request_failed',
      operation: 'fetchPlatformConfiguration',
      message: 'Dynamic registration OpenID configuration request failed',
      responseBodySummary: 'content-type: application/json',
    });
  });

  it('validates hostname against the final OpenID configuration URL after redirects', async () => {
    const errorLogger = vi.fn();
    const service = createService({
      storage: createStorageMock(),
      logger: {
        ...createLoggerMock(),
        error: errorLogger,
      },
    });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://issuer.example/openid-configuration' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          createOpenIdConfiguration({
            productFamilyCode: 'canvas',
            baseUrl: 'https://platform.example',
          }),
        ),
      );

    const failure = await service
      .fetchPlatformConfiguration({
        openid_configuration: 'https://issuer.example/openid-configuration/start',
        registration_token: 'registration-token',
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toMatchObject({
      code: 'platform_response_invalid',
      operation: 'fetchPlatformConfiguration',
      message: expect.stringContaining(
        'OpenID configuration issuer does not match the discovery endpoint',
      ),
    });
    expect(failure).toBeInstanceOf(Error);
    if (failure instanceof Error) {
      expect(failure.message).not.toContain('registration-token');
    }
    expect(errorLogger).toHaveBeenCalledWith(
      {
        endpointHostname: 'issuer.example',
        issuerHostname: 'platform.example',
      },
      'OpenID configuration issuer does not match the discovery endpoint',
    );
    expect(JSON.stringify(errorLogger.mock.calls)).not.toContain('registration-token');
  });

  it('reports a non-JSON OpenID configuration response without parsing its HTML', async () => {
    const service = createService({ storage: createStorageMock() });
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response('<!DOCTYPE html><title>Sign in</title>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      ),
    ) as typeof fetch;

    await expect(
      service.fetchPlatformConfiguration({
        openid_configuration: 'https://platform.example/openid-configuration',
      }),
    ).rejects.toMatchObject({
      code: 'platform_response_invalid',
      operation: 'fetchPlatformConfiguration',
      message: 'Dynamic registration OpenID configuration response must be JSON',
      responseBodySummary: 'content-type: text/html; charset=utf-8',
    });
  });

  it('stores app state during registration initiation', async () => {
    const storage = createStorageMock();
    const service = createService({ storage });
    mockJsonFetch(
      createOpenIdConfiguration({
        productFamilyCode: 'moodle',
        baseUrl: 'https://moodle.example',
      }),
    );

    await service.initiateDynamicRegistration(
      {
        openid_configuration: 'https://moodle.example/.well-known/openid-configuration',
        registration_token: 'reg-token-123',
      },
      '/lti/register',
      { appState: { tenantId: 'tenant-1', returnPath: '/admin/lti' } },
    );

    expect(storage.setRegistrationSession).toHaveBeenCalledWith(
      SESSION_TOKEN,
      expect.objectContaining({
        appState: { tenantId: 'tenant-1', returnPath: '/admin/lti' },
      }),
    );
  });

  it('posts registration to the platform endpoint with bearer token and stores deployment', async () => {
    const { fetchCall, result, storage } = await completeRegistrationAndCapturePayload({
      productFamilyCode: 'sakailms.org',
      baseUrl: 'https://sakai.example',
      registrationResponse: createRegistrationResponseWithDeployment(
        'sakai-client-id',
        '1',
      ),
      session: { appState: { tenantId: 'tenant-1' } },
    });

    expect(storage.deleteRegistrationSession).toHaveBeenCalledWith(SESSION_TOKEN);
    expect(storage.addClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'sakai-client-id',
        iss: 'https://sakai.example',
      }),
    );
    expect(storage.addDeployment).toHaveBeenCalledWith('client-record-id', {
      deploymentId: '1',
      name: 'Default Deployment via dynamic registration provided deployment id',
    });
    expect(storage.saveLaunchConfig).toHaveBeenCalledWith({
      iss: 'https://sakai.example',
      clientId: 'sakai-client-id',
      deploymentId: '1',
      authUrl: 'https://sakai.example/imsoidc/lti13/oidc_auth',
      tokenUrl: 'https://sakai.example/imsblis/lti13/token/1',
      jwksUrl: 'https://sakai.example/imsblis/lti13/keyset',
    });
    expect(result).toMatchObject({
      html: expect.stringContaining('Registration Successful'),
      client: {
        id: 'client-record-id',
        clientId: 'sakai-client-id',
        iss: 'https://sakai.example',
      },
      deployment: {
        id: 'deployment-record-id',
        deploymentId: '1',
      },
      launchConfig: {
        iss: 'https://sakai.example',
        clientId: 'sakai-client-id',
        deploymentId: '1',
      },
      createdClient: true,
      createdDeployment: true,
      appState: { tenantId: 'tenant-1' },
    });

    expect(fetchCall.input).toBe(
      'https://sakai.example/imsblis/lti13/registration_endpoint/1',
    );
    const headers = new Headers(fetchCall.init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer reg-token-123');
  });

  it('keeps unsupported platforms on the generic message path', async () => {
    const { requestBody } = await completeRegistrationAndCapturePayload({
      productFamilyCode: 'blackboard',
      baseUrl: 'https://blackboard.example',
      registrationResponse: createRegistrationResponse('blackboard-client-id'),
      services: ['deep_linking'],
    });

    expect(requestBody[LTI_CLAIM_TOOL_CONFIGURATION].messages).toEqual(
      expectedPlacementMessages({
        resourceLinkPlacements: [],
        deepLinkPlacements: ['editor_button'],
      }),
    );
  });

  it.each([
    {
      platformName: 'Brightspace',
      productFamilyCode: 'desire2learn',
      config: createToolConfig({
        platforms: {
          brightspace: {
            resourceLinkPlacements: ['course_tool'],
            deepLinkPlacements: ['editor_button', 'quicklink'],
          },
        },
      }),
      expectedResourceLinkPlacements: ['course_tool'],
      expectedDeepLinkPlacements: ['editor_button', 'quicklink'],
    },
    {
      platformName: 'Moodle',
      productFamilyCode: 'moodle',
      config: createToolConfig({
        platforms: {
          moodle: {
            resourceLinkPlacements: ['course_tool'],
            deepLinkPlacements: ['editor_button', 'activity_chooser'],
          },
        },
      }),
      expectedResourceLinkPlacements: ['course_tool'],
      expectedDeepLinkPlacements: ['editor_button', 'activity_chooser'],
    },
    {
      platformName: 'Sakai',
      productFamilyCode: 'sakailms.org',
      config: createToolConfig({
        platforms: {
          sakai: {
            resourceLinkPlacements: ['sakai_resource'],
            deepLinkPlacements: ['editor_button', 'sakai_content_picker'],
          },
        },
      }),
      expectedResourceLinkPlacements: ['sakai_resource'],
      expectedDeepLinkPlacements: ['editor_button', 'sakai_content_picker'],
    },
  ])('uses $platformName placement configuration', async (scenario) => {
    const { requestBody } = await completeRegistrationAndCapturePayload({
      productFamilyCode: scenario.productFamilyCode,
      config: scenario.config,
      services: ['deep_linking'],
    });

    expect(requestBody[LTI_CLAIM_TOOL_CONFIGURATION].messages).toEqual(
      expectedPlacementMessages({
        resourceLinkPlacements: scenario.expectedResourceLinkPlacements,
        deepLinkPlacements: scenario.expectedDeepLinkPlacements,
      }),
    );
  });

  it('uses the Canvas profile to add Canvas-specific fields and configurable placements', async () => {
    const { requestBody } = await completeRegistrationAndCapturePayload({
      productFamilyCode: 'canvas',
      baseUrl: 'https://canvas.example',
      config: createToolConfig({
        platforms: {
          canvas: {
            clientUri: TOOL_URL,
            privacyLevel: 'public',
            toolId: 'canvas-tool-123',
            vendor: 'Acme Learning',
            secondaryDomains: ['cdn.lti.local.test'],
            resourceLinkPlacements: ['course_navigation', 'link_selection'],
            deepLinkPlacements: ['editor_button', 'assignment_selection'],
          },
        },
      }),
      registrationResponse: createRegistrationResponse('canvas-client-id'),
      services: ['deep_linking'],
    });

    expect(requestBody.client_uri).toBe(TOOL_URL);
    expect(
      requestBody[LTI_CLAIM_TOOL_CONFIGURATION][
        'https://canvas.instructure.com/lti/privacy_level'
      ],
    ).toBe('public');
    expect(
      requestBody[LTI_CLAIM_TOOL_CONFIGURATION][
        'https://canvas.instructure.com/lti/tool_id'
      ],
    ).toBe('canvas-tool-123');
    expect(
      requestBody[LTI_CLAIM_TOOL_CONFIGURATION][
        'https://canvas.instructure.com/lti/vendor'
      ],
    ).toBe('Acme Learning');
    expect(requestBody[LTI_CLAIM_TOOL_CONFIGURATION].secondary_domains).toEqual([
      'cdn.lti.local.test',
    ]);
    expect(requestBody[LTI_CLAIM_TOOL_CONFIGURATION].messages).toEqual(
      expectedPlacementMessages({
        resourceLinkPlacements: ['course_navigation', 'link_selection'],
        deepLinkPlacements: ['editor_button', 'assignment_selection'],
      }),
    );
  });

  it('applies message and payload customization after profile defaults', async () => {
    const { requestBody } = await completeRegistrationAndCapturePayload({
      productFamilyCode: 'moodle',
      baseUrl: 'https://moodle.example',
      config: createToolConfig({
        platforms: {
          moodle: {
            deepLinkPlacements: ['editor_button'],
          },
        },
        customizeMessages: (context, messages) => [
          ...messages,
          {
            type: LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
            target_link_uri: context.deepLinkingUri,
            label: `${context.toolName} Custom Picker`,
            placements: ['custom_picker'],
            supported_types: ['ltiResourceLink'],
          },
        ],
        customizePayload: (context, payload) => ({
          ...payload,
          client_name:
            context.appState === 'tenant-a'
              ? `${payload.client_name} Tenant A`
              : payload.client_name,
          [LTI_CLAIM_TOOL_CONFIGURATION]: {
            ...payload[LTI_CLAIM_TOOL_CONFIGURATION],
            custom_parameters: {
              tenant: context.appState === 'tenant-a' ? 'tenant-a' : 'unknown',
            },
          },
        }),
      }),
      registrationResponse: createRegistrationResponse('moodle-client-id'),
      services: ['deep_linking'],
      session: { appState: 'tenant-a' },
    });

    expect(requestBody.client_name).toBe('My LTI Tool Tenant A');
    expect(requestBody[LTI_CLAIM_TOOL_CONFIGURATION].custom_parameters).toEqual({
      tenant: 'tenant-a',
    });
    expect(requestBody[LTI_CLAIM_TOOL_CONFIGURATION].messages).toContainEqual({
      type: LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
      target_link_uri: `${TOOL_URL}/lti/deep-linking`,
      label: 'My LTI Tool Custom Picker',
      placements: ['custom_picker'],
      supported_types: ['ltiResourceLink'],
    });
  });

  it('rejects invalid customized payloads before posting to the platform', async () => {
    const storage = createStorageMock();
    const service = createService({
      storage,
      config: createToolConfig({
        customizePayload: (_context, payload) => ({
          ...payload,
          initiate_login_uri: 'not-a-url',
        }),
      }),
    });

    vi.mocked(storage.getRegistrationSession).mockResolvedValue({
      openIdConfiguration: createOpenIdConfiguration({
        productFamilyCode: 'blackboard',
        baseUrl: 'https://blackboard.example',
      }),
      registrationToken: 'reg-token-123',
      expiresAt: Date.now() + 10_000,
    });
    const fetchMock = mockJsonFetch(createRegistrationResponse('blackboard-client-id'));

    await expect(
      service.completeDynamicRegistration({
        sessionToken: SESSION_TOKEN,
        services: [],
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
