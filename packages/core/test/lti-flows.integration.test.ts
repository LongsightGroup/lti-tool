import type * as Jose from 'jose'; // import for the vi importActual usage
import { createRemoteJWKSet, generateKeyPair, jwtVerify } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLTIPayload } from '#test-harness/fixtures';

import {
  LTI_CLAIM_CONTEXT,
  LTI_CLAIM_DEPLOYMENT_ID,
  LTI_CLAIM_MESSAGE_TYPE,
  LTI_CLAIM_RESOURCE_LINK,
  LTI_CLAIM_ROLES,
  LTI_CLAIM_TARGET_LINK_URI,
  LTI_CLAIM_VERSION,
  LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
  LTI_VERSION_1P3P0,
} from '../src/constants.js';
import {
  LtiLaunchVerificationError,
  type LTIConfig,
  type LTIStorage,
  type LtiLaunchVerificationEvent,
  type LtiVerifiedLaunch,
} from '../src/index.js';
import { LTITool } from '../src/ltiTool.js';

// Mock createRemoteJWKSet from jose to avoid actual HTTP calls
vi.mock('jose', async () => {
  const actual = await vi.importActual<typeof Jose>('jose');
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(),
    jwtVerify: vi.fn(actual.jwtVerify),
  };
});

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Create a mock storage implementation
const createMockStorage = (): LTIStorage => ({
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
  addSession: vi.fn().mockResolvedValue('session-id'),
  validateNonce: vi.fn(),
  getLaunchConfig: vi.fn(),
  saveLaunchConfig: vi.fn(),
  deleteRegistrationSession: vi.fn(),
  getRegistrationSession: vi.fn(),
  setRegistrationSession: vi.fn(),
});

describe('LTI Integration Tests', () => {
  let ltiTool: LTITool;
  let mockStorage: LTIStorage;
  let keyPair: CryptoKeyPair;
  let platformKeyPair: CryptoKeyPair;
  let stateSecret: Uint8Array;

  beforeAll(async () => {
    // Generate real key pairs for JWT signing/verification
    keyPair = await generateKeyPair('RS256');
    platformKeyPair = await generateKeyPair('RS256');
  });

  beforeEach(() => {
    vi.clearAllMocks();

    stateSecret = new TextEncoder().encode('test-state-secret-exactly32bytes');

    mockStorage = createMockStorage();

    const config: LTIConfig = {
      keyPair,
      stateSecret,
      storage: mockStorage,
      security: {
        keyId: 'test-key',
        stateExpirationSeconds: 300,
      },
    };

    ltiTool = new LTITool(config);

    // Setup default storage mocks
    vi.mocked(mockStorage.getClientById).mockResolvedValue({
      id: 'client123',
      name: 'Platform Example',
      iss: 'https://platform.example.com',
      clientId: 'client123',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/.well-known/jwks',
      deployments: [],
    });
    vi.mocked(mockStorage.getDeploymentByPlatformId).mockResolvedValue({
      id: 'deployment-internal-1',
      deploymentId: 'deployment1',
    });
    vi.mocked(mockStorage.getLaunchConfig).mockResolvedValue({
      iss: 'https://platform.example.com',
      clientId: 'client123',
      deploymentId: 'deployment1',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/.well-known/jwks',
    });

    vi.mocked(mockStorage.validateNonce).mockResolvedValue(true);

    // Mock createRemoteJWKSet to return a JWKS-compatible function
    const mockCreateRemoteJWKSet = vi.mocked(createRemoteJWKSet);
    mockCreateRemoteJWKSet.mockReturnValue((() => platformKeyPair.publicKey) as any);
  });

  async function signLaunchAndState(
    ltiPayload: Partial<Record<string, unknown>>,
    stateOverrides: Record<string, unknown> = {},
  ): Promise<{ jwt: string; stateJwt: string }> {
    const { SignJWT } = await import('jose');
    const jwt = await new SignJWT(ltiPayload)
      .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
      .sign(platformKeyPair.privateKey);
    const stateJwt = await new SignJWT({
      nonce: 'test-nonce',
      iss: 'https://platform.example.com',
      client_id: 'client123',
      target_link_uri: 'https://tool.example.com/content',
      exp: Math.floor(Date.now() / 1000) + 300,
      ...stateOverrides,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(stateSecret);

    return { jwt, stateJwt };
  }

  async function verifyLaunchOrThrow(
    idToken: string,
    state: string,
  ): Promise<LtiVerifiedLaunch> {
    const result = await ltiTool.verifyLaunch(idToken, state);
    if (!result.success) {
      throw new Error(`Expected launch verification success: ${result.error.code}`);
    }

    return result.launch;
  }

  async function expectLaunchFailure(
    idToken: string,
    state: string,
    code: LtiLaunchVerificationError['code'],
  ): Promise<void> {
    const result = await ltiTool.verifyLaunch(idToken, state);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected launch verification failure');
    expect(result.error.code).toBe(code);
  }

  describe('Login Flow', () => {
    it('generates valid login URL with state and nonce', async () => {
      const loginParams = {
        client_id: 'client123',
        iss: 'https://platform.example.com',
        launchUrl: 'https://tool.example.com/launch',
        login_hint: 'user123',
        target_link_uri: 'https://tool.example.com/content',
        lti_deployment_id: 'deployment1',
        lti_message_hint: 'hint123',
      };

      const authUrl = await ltiTool.handleLogin(loginParams);

      expect(authUrl).toMatch(/^https:\/\/platform\.example\.com\/auth\?/);

      const url = new URL(authUrl);
      expect(url.searchParams.get('scope')).toBe('openid');
      expect(url.searchParams.get('response_type')).toBe('id_token');
      expect(url.searchParams.get('response_mode')).toBe('form_post');
      expect(url.searchParams.get('client_id')).toBe('client123');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://tool.example.com/launch',
      );
      expect(url.searchParams.get('login_hint')).toBe('user123');
      expect(url.searchParams.get('lti_deployment_id')).toBe('deployment1');
      expect(url.searchParams.get('lti_message_hint')).toBe('hint123');
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('nonce')).toBeTruthy();
    });

    it('throws error when launch config not found', async () => {
      vi.mocked(mockStorage.getLaunchConfig).mockResolvedValue(undefined);

      const loginParams = {
        client_id: 'unknown-client',
        iss: 'https://unknown.platform.com',
        launchUrl: 'https://tool.example.com/launch',
        login_hint: 'user123',
        target_link_uri: 'https://tool.example.com/content',
        lti_deployment_id: 'deployment1',
      };

      await expect(ltiTool.handleLogin(loginParams)).rejects.toThrow(
        'No valid launch config found',
      );
    });
  });

  describe('Session Creation Flow', () => {
    it('creates session from a verified launch', async () => {
      const ltiPayload = createMockLTIPayload();
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);
      const launch = await verifyLaunchOrThrow(jwt, stateJwt);

      const session = await ltiTool.createSessionFromVerifiedLaunch(launch);

      expect(session.user.name).toBe('Jane Smith');
      expect(session.user.email).toBe('jane.smith@university.edu');
      expect(session.isInstructor).toBe(true);
      expect(session.isStudent).toBe(false);
      expect(session.context.label).toBe('MATH201');
      expect(session.context.title).toBe('Advanced Mathematics');
      expect(session.resourceLink?.title).toBe('Homework 3');
      expect(session.isAssignmentAndGradesAvailable).toBe(true);
      expect(session.services?.ags?.lineitem).toBe(
        'https://platform.example.com/api/ags/lineitem/789',
      );

      // Verify session was stored
      expect(mockStorage.addSession).toHaveBeenCalledWith(session);
    });
  });

  describe('JWKS Generation', () => {
    it('generates valid JWKS with configured key ID', async () => {
      const jwks = await ltiTool.getJWKS();

      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0].use).toBe('sig');
      expect(jwks.keys[0].alg).toBe('RS256');
      expect(jwks.keys[0].kid).toBe('test-key');
      expect(jwks.keys[0].kty).toBe('RSA');
    });
  });

  describe('JWT Verification', () => {
    it('refreshes JWKS and retries once on ERR_JWKS_NO_MATCHING_KEY', async () => {
      const events: LtiLaunchVerificationEvent[] = [];
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const idTokenPayload = {
        iss: 'https://platform.example.com',
        aud: 'client123',
        nonce: 'test-nonce',
        [LTI_CLAIM_DEPLOYMENT_ID]: 'deployment1',
      };
      const idToken = [
        Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'rotated-kid' })).toString(
          'base64url',
        ),
        Buffer.from(JSON.stringify(idTokenPayload)).toString('base64url'),
        'signature',
      ].join('.');

      const staleJwks = vi.fn();
      const freshJwks = vi.fn();
      vi.mocked(createRemoteJWKSet)
        .mockReturnValueOnce(staleJwks as any)
        .mockReturnValueOnce(freshJwks as any);

      const kidMissError = Object.assign(new Error('No matching key in JWKS'), {
        code: 'ERR_JWKS_NO_MATCHING_KEY',
      });
      vi.mocked(jwtVerify)
        .mockResolvedValueOnce({
          payload: {
            nonce: 'test-nonce',
            iss: 'https://platform.example.com',
            client_id: 'client123',
            target_link_uri: 'https://tool.example.com/content',
          },
        } as any)
        .mockRejectedValueOnce(kidMissError as any)
        .mockResolvedValueOnce({ payload: ltiPayload } as any);

      const result = await ltiTool.verifyLaunch(idToken, 'state-token', {
        onVerificationEvent: (event) => events.push(event),
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected launch verification success');
      const { launch } = result;
      expect(launch.payload).toEqual(ltiPayload);
      expect(createRemoteJWKSet).toHaveBeenCalledTimes(2);
      expect(jwtVerify).toHaveBeenCalledTimes(3);
      expect(jwtVerify).toHaveBeenNthCalledWith(2, idToken, staleJwks, {
        audience: 'client123',
      });
      expect(jwtVerify).toHaveBeenNthCalledWith(3, idToken, freshJwks, {
        audience: 'client123',
      });
      expect(mockStorage.validateNonce).toHaveBeenCalledWith('test-nonce');
      expect(events).toEqual([
        {
          type: 'jwks_kid_miss_refetch',
          issuer: 'https://platform.example.com',
          clientId: 'client123',
          deploymentId: 'deployment1',
          jwksUrl: 'https://platform.example.com/.well-known/jwks',
        },
        {
          type: 'launch_verified',
          issuer: 'https://platform.example.com',
          clientId: 'client123',
          deploymentId: 'deployment1',
        },
      ]);
    });

    it('emits JWKS refetch events before later verification failures', async () => {
      const events: LtiLaunchVerificationEvent[] = [];
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const idTokenPayload = {
        iss: 'https://platform.example.com',
        aud: 'client123',
        nonce: 'test-nonce',
        [LTI_CLAIM_DEPLOYMENT_ID]: 'deployment1',
      };
      const idToken = [
        Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'rotated-kid' })).toString(
          'base64url',
        ),
        Buffer.from(JSON.stringify(idTokenPayload)).toString('base64url'),
        'signature',
      ].join('.');

      const staleJwks = vi.fn();
      const freshJwks = vi.fn();
      vi.mocked(createRemoteJWKSet)
        .mockReturnValueOnce(staleJwks as any)
        .mockReturnValueOnce(freshJwks as any);

      const kidMissError = Object.assign(new Error('No matching key in JWKS'), {
        code: 'ERR_JWKS_NO_MATCHING_KEY',
      });
      vi.mocked(jwtVerify)
        .mockResolvedValueOnce({
          payload: {
            nonce: 'test-nonce',
            iss: 'https://platform.example.com',
            client_id: 'client123',
            target_link_uri: 'https://tool.example.com/content',
          },
        } as any)
        .mockRejectedValueOnce(kidMissError as any)
        .mockResolvedValueOnce({ payload: ltiPayload } as any);
      vi.mocked(mockStorage.validateNonce).mockResolvedValue(false);

      const result = await ltiTool.verifyLaunch(idToken, 'state-token', {
        onVerificationEvent: (event) => events.push(event),
      });

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected launch verification failure');
      expect(result.error.code).toBe('nonce_replay');
      expect(events).toEqual([
        {
          type: 'jwks_kid_miss_refetch',
          issuer: 'https://platform.example.com',
          clientId: 'client123',
          deploymentId: 'deployment1',
          jwksUrl: 'https://platform.example.com/.well-known/jwks',
        },
        {
          type: 'launch_verification_failed',
          code: 'nonce_replay',
        },
      ]);
    });

    it('successfully verifies valid LTI launch JWT', async () => {
      // Create a valid LTI JWT using the platform key
      const ltiPayload = createMockLTIPayload({
        given_name: 'John',
        family_name: 'Doe',
        name: 'John Doe',
        email: 'john.doe@university.edu',
        [LTI_CLAIM_ROLES]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
        [LTI_CLAIM_CONTEXT]: {
          id: 'course123',
          label: 'CS101',
        },
        [LTI_CLAIM_RESOURCE_LINK]: {
          id: 'assignment789',
          title: 'Lab 1',
        },
      });

      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const launch = await verifyLaunchOrThrow(jwt, stateJwt);
      const session = await ltiTool.createSessionFromVerifiedLaunch(launch);

      expect(session.user.name).toBe('John Doe');
      expect(session.user.email).toBe('john.doe@university.edu');
      expect(session.isStudent).toBe(true);
      expect(session.isInstructor).toBe(false);
      expect(session.context.label).toBe('CS101');
      expect(session.resourceLink?.title).toBe('Lab 1');
    });

    it('returns structured launch verification details', async () => {
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected launch verification success');
      expect(result.launch.payload).toEqual(ltiPayload);
      expect(result.launch.issuer).toBe('https://platform.example.com');
      expect(result.launch.clientId).toBe('client123');
      expect(result.launch.deploymentId).toBe('deployment1');
      expect(result.launch.targetLinkUri).toBe('https://tool.example.com/content');
    });

    it('emits launch verification success events', async () => {
      const events: LtiLaunchVerificationEvent[] = [];
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt, {
        onVerificationEvent: (event) => events.push(event),
      });

      expect(result.success).toBe(true);
      expect(events).toEqual([
        {
          type: 'launch_verified',
          issuer: 'https://platform.example.com',
          clientId: 'client123',
          deploymentId: 'deployment1',
        },
      ]);
    });

    it('emits configured launch verification events', async () => {
      const events: LtiLaunchVerificationEvent[] = [];
      ltiTool = new LTITool({
        keyPair,
        stateSecret,
        storage: mockStorage,
        onVerificationEvent: (event) => events.push(event),
        security: {
          keyId: 'test-key',
          stateExpirationSeconds: 300,
        },
      });
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt);

      expect(result.success).toBe(true);
      expect(events).toEqual([
        {
          type: 'launch_verified',
          issuer: 'https://platform.example.com',
          clientId: 'client123',
          deploymentId: 'deployment1',
        },
      ]);
    });

    it('emits launch verification failure events', async () => {
      const events: LtiLaunchVerificationEvent[] = [];

      const result = await ltiTool.verifyLaunch('', '', {
        onVerificationEvent: (event) => events.push(event),
      });

      expect(result.success).toBe(false);
      expect(events).toEqual([
        {
          type: 'launch_verification_failed',
          code: 'invalid_launch_parameters',
        },
      ]);
    });

    it('keeps observer failures isolated from launch verification', async () => {
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt, {
        onVerificationEvent: () => {
          throw new Error('audit unavailable');
        },
      });

      expect(result.success).toBe(true);
    });

    it('passes remote JWKS bounds to jose', async () => {
      ltiTool = new LTITool({
        keyPair,
        stateSecret,
        storage: mockStorage,
        security: {
          keyId: 'test-key',
          stateExpirationSeconds: 300,
          remoteJwks: {
            cooldownDuration: 1_000,
            cacheMaxAge: 60_000,
            timeoutDuration: 2_000,
          },
        },
      });
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt);

      expect(result.success).toBe(true);
      expect(createRemoteJWKSet).toHaveBeenCalledWith(
        new URL('https://platform.example.com/.well-known/jwks'),
        {
          cooldownDuration: 1_000,
          cacheMaxAge: 60_000,
          timeoutDuration: 2_000,
        },
      );
    });

    it('creates sessions directly from verified multi-audience launches', async () => {
      ltiTool = new LTITool({
        keyPair,
        stateSecret,
        storage: mockStorage,
        security: {
          keyId: 'test-key',
          stateExpirationSeconds: 300,
          trustedAudiences: ['other-client'],
        },
      });

      const ltiPayload = createMockLTIPayload({
        aud: ['other-client', 'client123'],
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected launch verification success');

      const session = await ltiTool.createSessionFromVerifiedLaunch(result.launch);

      expect(session.platform.clientId).toBe('client123');
      expect(mockStorage.addSession).toHaveBeenCalledWith(session);
    });

    it('authorizes verified launches with app metadata', async () => {
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt, {
        authorizeVerifiedLaunch: (launch) => {
          expect(launch.issuer).toBe('https://platform.example.com');
          expect(launch.clientId).toBe('client123');

          return {
            success: true,
            data: {
              tenantId: 'tenant-1',
              installationId: 'installation-1',
            },
          };
        },
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected launch authorization success');
      expect(result.launch.authorization).toEqual({
        tenantId: 'tenant-1',
        installationId: 'installation-1',
      });
    });

    it('reports verified launch authorization failures distinctly', async () => {
      const events: LtiLaunchVerificationEvent[] = [];
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt, {
        authorizeVerifiedLaunch: () => ({
          success: false as const,
          code: 'installation_not_authorized',
          message: 'Installation is not enabled for this app',
        }),
        onVerificationEvent: (event) => events.push(event),
      });

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected launch authorization failure');
      expect(result.error.code).toBe('verified_launch_authorization_failed');
      expect(result.error.message).toBe('Installation is not enabled for this app');
      expect(events).toEqual([
        {
          type: 'launch_verification_failed',
          code: 'verified_launch_authorization_failed',
        },
      ]);
    });

    it('returns structured launch verification errors', async () => {
      const result = await ltiTool.verifyLaunch('', '');

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected launch verification failure');
      expect(result.error).toBeInstanceOf(LtiLaunchVerificationError);
      expect(result.error.code).toBe('invalid_launch_parameters');
    });

    it('reports missing launch config without admin client or deployment lookups', async () => {
      vi.mocked(mockStorage.getLaunchConfig).mockResolvedValue(undefined);
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected launch verification failure');
      expect(result.error.code).toBe('launch_config_not_found');
      expect(mockStorage.getLaunchConfig).toHaveBeenCalledWith(
        'https://platform.example.com',
        'client123',
        'deployment1',
      );
      expect(mockStorage.getClientById).not.toHaveBeenCalled();
      expect(mockStorage.getDeploymentByPlatformId).not.toHaveBeenCalled();
    });

    it('reports missing launch endpoints precisely', async () => {
      vi.mocked(mockStorage.getLaunchConfig).mockResolvedValue({
        iss: 'https://platform.example.com',
        clientId: 'client123',
        deploymentId: 'deployment1',
        authUrl: 'https://platform.example.com/auth',
        tokenUrl: 'https://platform.example.com/token',
        jwksUrl: '',
      });
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected launch verification failure');
      expect(result.error.code).toBe('launch_config_missing_jwks_endpoint');
    });

    it('reports launch config storage failures precisely', async () => {
      vi.mocked(mockStorage.getLaunchConfig).mockRejectedValue(
        new Error('database unavailable'),
      );
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });
      const { jwt, stateJwt } = await signLaunchAndState(ltiPayload);

      const result = await ltiTool.verifyLaunch(jwt, stateJwt);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected launch verification failure');
      expect(result.error.code).toBe('launch_config_lookup_failed');
    });

    it('successfully verifies LTI launch JWT with array audience', async () => {
      const ltiPayload = createMockLTIPayload({
        aud: ['client123'],
        nonce: 'test-nonce',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      const launch = await verifyLaunchOrThrow(jwt, stateJwt);

      expect(launch.payload.aud).toEqual(['client123']);
      expect(mockStorage.getLaunchConfig).toHaveBeenCalledWith(
        'https://platform.example.com',
        'client123',
        'deployment1',
      );
    });

    it('binds launch config and session client ID to state when aud order differs', async () => {
      ltiTool = new LTITool({
        keyPair,
        stateSecret,
        storage: mockStorage,
        security: {
          keyId: 'test-key',
          stateExpirationSeconds: 300,
          trustedAudiences: ['other-client'],
        },
      });

      vi.mocked(mockStorage.getLaunchConfig).mockImplementation(
        (iss, clientId, deploymentId) =>
          Promise.resolve({
            iss,
            clientId,
            deploymentId,
            authUrl: 'https://platform.example.com/auth',
            tokenUrl: 'https://platform.example.com/token',
            jwksUrl: 'https://platform.example.com/.well-known/jwks',
          }),
      );

      const ltiPayload = createMockLTIPayload({
        aud: ['other-client', 'client123'],
        nonce: 'test-nonce',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      const launch = await verifyLaunchOrThrow(jwt, stateJwt);
      const session = await ltiTool.createSessionFromVerifiedLaunch(launch);

      expect(launch.payload.aud).toEqual(['other-client', 'client123']);
      expect(session.platform.clientId).toBe('client123');
      expect(mockStorage.getLaunchConfig).toHaveBeenCalledTimes(1);
      expect(mockStorage.getLaunchConfig).toHaveBeenCalledWith(
        'https://platform.example.com',
        'client123',
        'deployment1',
      );
    });

    it('rejects LTI launch JWT with untrusted additional audience', async () => {
      const ltiPayload = createMockLTIPayload({
        aud: ['client123', 'other-client'],
        nonce: 'test-nonce',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(jwt, stateJwt, 'untrusted_audience');
    });

    it('rejects LTI launch JWT when state client_id is not in audience', async () => {
      const ltiPayload = createMockLTIPayload({
        aud: ['other-client'],
        nonce: 'test-nonce',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(jwt, stateJwt, 'jwt_verification_failed');
    });

    it('rejects LTI launch JWT when state issuer differs from token issuer', async () => {
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://different-platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(jwt, stateJwt, 'issuer_mismatch');
    });

    it('successfully verifies LTI launch JWT when target_link_uri matches state', async () => {
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
        [LTI_CLAIM_TARGET_LINK_URI]: 'https://tool.example.com/content',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      const launch = await verifyLaunchOrThrow(jwt, stateJwt);

      expect(launch.payload[LTI_CLAIM_TARGET_LINK_URI]).toBe(
        'https://tool.example.com/content',
      );
      expect(mockStorage.validateNonce).toHaveBeenCalledWith('test-nonce');
    });

    it('rejects LTI launch JWT when state is missing target_link_uri', async () => {
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(jwt, stateJwt, 'state_verification_failed');
      expect(mockStorage.validateNonce).not.toHaveBeenCalled();
    });

    it('rejects LTI launch JWT when target_link_uri differs from state', async () => {
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
        [LTI_CLAIM_TARGET_LINK_URI]: 'https://attacker.example.com/content',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(jwt, stateJwt, 'target_link_uri_mismatch');
      expect(mockStorage.validateNonce).not.toHaveBeenCalled();
    });

    it('rejects LTI launch JWT when target_link_uri has non-identical URL formatting', async () => {
      const ltiPayload = createMockLTIPayload({
        nonce: 'test-nonce',
        [LTI_CLAIM_TARGET_LINK_URI]: 'https://tool.example.com/content/',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(jwt, stateJwt, 'target_link_uri_mismatch');
      expect(mockStorage.validateNonce).not.toHaveBeenCalled();
    });

    it('successfully verifies LTI launch JWT with trusted additional audience', async () => {
      ltiTool = new LTITool({
        keyPair,
        stateSecret,
        storage: mockStorage,
        security: {
          keyId: 'test-key',
          stateExpirationSeconds: 300,
          trustedAudiences: ['other-client'],
        },
      });

      const ltiPayload = createMockLTIPayload({
        aud: ['client123', 'other-client'],
        nonce: 'test-nonce',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      const launch = await verifyLaunchOrThrow(jwt, stateJwt);

      expect(launch.payload.aud).toEqual(['client123', 'other-client']);
    });

    it('rejects LTI launch JWT with empty audience array', async () => {
      const ltiPayload = createMockLTIPayload({
        aud: [],
        nonce: 'test-nonce',
      });

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(jwt, stateJwt, 'jwt_verification_failed');
    });

    it('rejects LTI launch JWT without deployment_id claim', async () => {
      const ltiPayload = createMockLTIPayload();
      delete ltiPayload[LTI_CLAIM_DEPLOYMENT_ID];

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(jwt, stateJwt, 'missing_deployment_id');
    });

    it('rejects JWT with invalid signature', async () => {
      // Create a JWT signed with the wrong key
      const ltiPayload = {
        iss: 'https://platform.example.com',
        aud: 'client123',
        sub: 'user123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: 'test-nonce',
        [LTI_CLAIM_MESSAGE_TYPE]: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
        [LTI_CLAIM_VERSION]: LTI_VERSION_1P3P0,
        [LTI_CLAIM_DEPLOYMENT_ID]: 'deployment1',
        [LTI_CLAIM_TARGET_LINK_URI]: 'https://tool.example.com/content',
      };

      // Sign with the tool's key instead of platform key (wrong key)
      const { SignJWT } = await import('jose');
      const invalidJwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'wrong-key' })
        .sign(keyPair.privateKey);

      const statePayload = {
        nonce: 'test-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(invalidJwt, stateJwt, 'jwt_verification_failed');
    });

    it('rejects JWT with invalid nonce', async () => {
      // Mock nonce validation to return false
      vi.mocked(mockStorage.validateNonce).mockResolvedValue(false);

      const ltiPayload = {
        iss: 'https://platform.example.com',
        aud: 'client123',
        sub: 'user123',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: 'invalid-nonce',
        given_name: 'John',
        family_name: 'Doe',
        name: 'John Doe',
        email: 'john.doe@university.edu',
        [LTI_CLAIM_MESSAGE_TYPE]: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
        [LTI_CLAIM_VERSION]: LTI_VERSION_1P3P0,
        [LTI_CLAIM_DEPLOYMENT_ID]: 'deployment1',
        [LTI_CLAIM_TARGET_LINK_URI]: 'https://tool.example.com/content',
        [LTI_CLAIM_ROLES]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
      };

      const { SignJWT } = await import('jose');
      const jwt = await new SignJWT(ltiPayload)
        .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
        .sign(platformKeyPair.privateKey);

      const statePayload = {
        nonce: 'invalid-nonce',
        iss: 'https://platform.example.com',
        client_id: 'client123',
        target_link_uri: 'https://tool.example.com/content',
        exp: Math.floor(Date.now() / 1000) + 300,
      };

      const stateJwt = await new SignJWT(statePayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(stateSecret);

      await expectLaunchFailure(jwt, stateJwt, 'nonce_replay');
    });
  });
});
