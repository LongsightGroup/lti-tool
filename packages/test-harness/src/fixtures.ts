import {
  LTI_AGS_SCOPE_SCORE,
  LTI_CLAIM_AGS_ENDPOINT,
  LTI_CLAIM_CONTEXT,
  LTI_CLAIM_DEPLOYMENT_ID,
  LTI_CLAIM_MESSAGE_TYPE,
  LTI_CLAIM_PLATFORM_CONFIGURATION,
  LTI_CLAIM_RESOURCE_LINK,
  LTI_CLAIM_ROLES,
  LTI_CLAIM_TARGET_LINK_URI,
  LTI_CLAIM_VERSION,
  LTI13JwtPayloadSchema,
  LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
  LTI_VERSION_1P3P0,
  type LTI13JwtPayload,
  type LTIClient,
  type LTIDeployment,
  type LTIDynamicRegistrationSession,
  type LTILaunchConfig,
  type LTISession,
} from '@longsightgroup/lti-tool';

export const createMockLTIPayload = (
  overrides: Partial<LTI13JwtPayload> = {},
): LTI13JwtPayload =>
  LTI13JwtPayloadSchema.parse({
    iss: 'https://platform.example.com',
    aud: 'client123',
    sub: 'user123',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: 'test-nonce',
    given_name: 'Jane',
    family_name: 'Smith',
    name: 'Jane Smith',
    email: 'jane.smith@university.edu',
    [LTI_CLAIM_MESSAGE_TYPE]: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
    [LTI_CLAIM_VERSION]: LTI_VERSION_1P3P0,
    [LTI_CLAIM_DEPLOYMENT_ID]: 'deployment1',
    [LTI_CLAIM_TARGET_LINK_URI]: 'https://tool.example.com/content',
    [LTI_CLAIM_ROLES]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
    [LTI_CLAIM_CONTEXT]: {
      id: 'course456',
      label: 'MATH201',
      title: 'Advanced Mathematics',
    },
    [LTI_CLAIM_RESOURCE_LINK]: {
      id: 'assignment789',
      title: 'Homework 3',
    },
    [LTI_CLAIM_AGS_ENDPOINT]: {
      lineitem: 'https://platform.example.com/api/ags/lineitem/789',
      lineitems: 'https://platform.example.com/api/ags/lineitems',
      scope: [LTI_AGS_SCOPE_SCORE],
    },
    ...overrides,
  });

export function testClient(
  overrides: Partial<Omit<LTIClient, 'id' | 'deployments'>> = {},
): Omit<LTIClient, 'id' | 'deployments'> {
  return {
    name: 'Test Platform',
    iss: 'https://platform.example.com',
    clientId: 'oauth-client-id',
    authUrl: 'https://platform.example.com/auth',
    tokenUrl: 'https://platform.example.com/token',
    jwksUrl: 'https://platform.example.com/jwks',
    ...overrides,
  };
}

export function testDeployment(
  overrides: Partial<Omit<LTIDeployment, 'id'>> = {},
): Omit<LTIDeployment, 'id'> {
  return {
    deploymentId: 'platform-deployment-id',
    name: 'Test Deployment',
    description: 'A test deployment',
    ...overrides,
  };
}

export function testLaunchConfig(
  overrides: Partial<LTILaunchConfig> = {},
): LTILaunchConfig {
  return {
    iss: 'https://platform.example.com',
    clientId: 'oauth-client-id',
    deploymentId: 'platform-deployment-id',
    authUrl: 'https://platform.example.com/auth',
    tokenUrl: 'https://platform.example.com/token',
    jwksUrl: 'https://platform.example.com/jwks',
    ...overrides,
  };
}

export function testSession(overrides: Partial<LTISession> = {}): LTISession {
  return {
    id: 'session-id',
    jwtPayload: createMockLTIPayload(),
    user: { id: 'user-id', roles: ['Learner'] },
    context: { id: 'context-id', label: 'TEST101', title: 'Test Course' },
    platform: {
      issuer: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      deploymentId: 'platform-deployment-id',
      name: 'Test Platform',
    },
    launch: { target: 'https://tool.example.com/launch' },
    customParameters: {},
    isAdmin: false,
    isInstructor: false,
    isStudent: true,
    isAssignmentAndGradesAvailable: false,
    isDeepLinkingAvailable: false,
    isNameAndRolesAvailable: false,
    ...overrides,
  };
}

export function testRegistrationSession(
  overrides: Partial<LTIDynamicRegistrationSession> = {},
): LTIDynamicRegistrationSession {
  return {
    registrationToken: 'registration-token',
    appState: {
      tenantId: 'tenant-1',
      returnPath: '/admin/lti',
      selectedFeatures: ['launch', 'deep_linking'],
    },
    expiresAt: Date.now() + 60_000,
    openIdConfiguration: {
      issuer: 'https://platform.example.com',
      authorization_endpoint: 'https://platform.example.com/auth',
      registration_endpoint: 'https://platform.example.com/register',
      jwks_uri: 'https://platform.example.com/jwks',
      token_endpoint: 'https://platform.example.com/token',
      token_endpoint_auth_methods_supported: ['private_key_jwt'],
      token_endpoint_auth_signing_alg_values_supported: ['RS256'],
      scopes_supported: [],
      response_types_supported: ['id_token'],
      id_token_signing_alg_values_supported: ['RS256'],
      claims_supported: ['sub'],
      subject_types_supported: ['public'],
      [LTI_CLAIM_PLATFORM_CONFIGURATION]: {
        product_family_code: 'test',
        version: '1',
        messages_supported: [{ type: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST }],
      },
    },
    ...overrides,
  };
}
