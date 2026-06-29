import { exportJWK, SignJWT } from 'jose';
import type { Logger } from 'pino';

import { LTI_AGS_SCOPE_SCORE } from './constants.js';
import {
  LtiServiceError,
  type LtiServiceErrorCode,
  type LtiServiceKind,
  type LtiServiceResult,
} from './errors/ltiServiceError.js';
import type { JWKS } from './interfaces/jwks.js';
import type { LTIClient } from './interfaces/ltiClient.js';
import type { LTIConfig } from './interfaces/ltiConfig.js';
import type { LTIDeployment } from './interfaces/ltiDeployment.js';
import type { LTIDynamicRegistrationSession } from './interfaces/ltiDynamicRegistrationSession.js';
import type { LTILaunchConfig } from './interfaces/ltiLaunchConfig.js';
import type { LTISession } from './interfaces/ltiSession.js';
import type { LTIStorage } from './interfaces/ltiStorage.js';
import { AddClientSchema, UpdateClientSchema } from './schemas/client.schema.js';
import {
  type DynamicRegistrationForm,
  HandleLoginParamsSchema,
  type LTI13JwtPayload,
  type RegistrationRequest,
  SessionIdSchema,
} from './schemas/index.js';
import {
  type CreateLineItem,
  type LineItem,
  type LineItems,
  LineItemSchema,
  LineItemsSchema,
  type UpdateLineItem,
} from './schemas/lti13/ags/lineItem.schema.js';
import { type Results, ResultsSchema } from './schemas/lti13/ags/result.schema.js';
import { type ScoreSubmission } from './schemas/lti13/ags/scoreSubmission.schema.js';
import { type DeepLinkingContentItem } from './schemas/lti13/deepLinking/contentItem.schema.js';
import { type OpenIDConfiguration } from './schemas/lti13/dynamicRegistration/openIDConfiguration.schema.js';
import { type Member } from './schemas/lti13/nrps/contextMembership.schema.js';
import {
  AGSService,
  type AGSGetScoresOptions,
  type AGSLineItemTargetOptions,
  type AGSListLineItemsOptions,
} from './services/ags.service.js';
import { DeepLinkingService } from './services/deepLinking.service.js';
import {
  DynamicRegistrationService,
  type LtiDynamicRegistrationCompletionResult,
} from './services/dynamicRegistration.service.js';
import { NRPSService } from './services/nrps.service.js';
import { createSession } from './services/session.service.js';
import { TokenService } from './services/token.service.js';
import { formatError } from './utils/errorFormatting.js';
import { getValidLaunchConfig } from './utils/launchConfigValidation.js';
import {
  authorizeVerifiedLaunch,
  type LtiLaunchJwksCache,
  type LtiAuthorizedLaunch,
  LtiLaunchVerificationError,
  type LtiLaunchVerificationResult,
  type LtiVerifyLaunchDetailedOptions,
  type LtiVerifiedLaunch,
  verifyLtiLaunch,
} from './utils/ltiLaunchVerification.js';
import { buildLtiLoginAuthUrl } from './utils/ltiLogin.js';
import { normalizeLtiNrpsMembersResponse } from './utils/nrps.js';

export interface LtiLaunchRegistrationInput {
  /** Platform issuer URL that uniquely identifies the LMS */
  iss: string;
  /** OAuth2 client identifier assigned by the platform */
  clientId: string;
  /** LMS-provided deployment identifier used in LTI launch requests */
  deploymentId: string;
  /** Platform's OIDC authentication endpoint URL */
  authUrl: string;
  /** Platform's OAuth2 token endpoint URL for service access */
  tokenUrl: string;
  /** Platform's JSON Web Key Set endpoint URL for JWT verification */
  jwksUrl: string;
  /** Optional human-readable platform name. Defaults to the issuer for new clients. */
  name?: string;
  /** Optional human-readable deployment name when creating or updating the deployment. */
  deploymentName?: string;
  /** Optional deployment description when creating or updating the deployment. */
  deploymentDescription?: string;
}

export interface LtiLaunchRegistrationUpsertResult {
  client: LTIClient;
  deployment: LTIDeployment;
  launchConfig: LTILaunchConfig;
  createdClient: boolean;
  createdDeployment: boolean;
}

type StoredClient = Omit<LTIClient, 'deployments'>;

const launchRegistrationClientInput = (
  registration: LtiLaunchRegistrationInput,
  existingClient?: StoredClient,
): Omit<LTIClient, 'id' | 'deployments'> => {
  return AddClientSchema.parse({
    name: registration.name ?? existingClient?.name ?? registration.iss,
    iss: registration.iss,
    clientId: registration.clientId,
    authUrl: registration.authUrl,
    tokenUrl: registration.tokenUrl,
    jwksUrl: registration.jwksUrl,
  });
};

const findLaunchRegistrationClient = async (
  storage: LTIStorage,
  registration: LtiLaunchRegistrationInput,
): Promise<StoredClient | undefined> => {
  const clients = await storage.listClients();
  return clients.find(
    (client) =>
      client.iss === registration.iss && client.clientId === registration.clientId,
  );
};

const upsertLaunchRegistrationClient = async (
  storage: LTIStorage,
  registration: LtiLaunchRegistrationInput,
): Promise<{ client: StoredClient; createdClient: boolean }> => {
  const existingClient = await findLaunchRegistrationClient(storage, registration);
  const clientInput = launchRegistrationClientInput(registration, existingClient);

  if (existingClient === undefined) {
    const clientId = await storage.addClient(clientInput);
    return { client: { id: clientId, ...clientInput }, createdClient: true };
  }

  await storage.updateClient(existingClient.id, clientInput);
  return { client: { id: existingClient.id, ...clientInput }, createdClient: false };
};

const launchRegistrationDeploymentInput = (
  registration: LtiLaunchRegistrationInput,
): Omit<LTIDeployment, 'id'> => ({
  deploymentId: registration.deploymentId,
  ...(registration.deploymentName === undefined
    ? {}
    : { name: registration.deploymentName }),
  ...(registration.deploymentDescription === undefined
    ? {}
    : { description: registration.deploymentDescription }),
});

const upsertLaunchRegistrationDeployment = async (
  storage: LTIStorage,
  clientId: string,
  registration: LtiLaunchRegistrationInput,
): Promise<{
  deployment: LTIDeployment;
  deployments: LTIDeployment[];
  createdDeployment: boolean;
}> => {
  const deployments = await storage.listDeployments(clientId);
  const existingDeployment = deployments.find(
    (deployment) => deployment.deploymentId === registration.deploymentId,
  );
  const deploymentInput = launchRegistrationDeploymentInput(registration);

  if (existingDeployment === undefined) {
    const deployment = {
      id: await storage.addDeployment(clientId, deploymentInput),
      ...deploymentInput,
    };
    return {
      deployment,
      deployments: [...deployments, deployment],
      createdDeployment: true,
    };
  }

  const deployment = { ...existingDeployment, ...deploymentInput };

  if (
    registration.deploymentName !== undefined ||
    registration.deploymentDescription !== undefined
  ) {
    await storage.updateDeployment(clientId, existingDeployment.id, deploymentInput);
  }

  return {
    deployment,
    deployments: deployments.map((candidate) =>
      candidate.id === deployment.id ? deployment : candidate,
    ),
    createdDeployment: false,
  };
};

const launchConfigFromRegistration = (
  registration: LtiLaunchRegistrationInput,
): LTILaunchConfig => ({
  iss: registration.iss,
  clientId: registration.clientId,
  deploymentId: registration.deploymentId,
  authUrl: registration.authUrl,
  tokenUrl: registration.tokenUrl,
  jwksUrl: registration.jwksUrl,
});

const ltiServiceFailure = <T>(
  error: unknown,
  serviceKind: Exclude<LtiServiceKind, 'token'>,
  operation: string,
): LtiServiceResult<T> => {
  if (error instanceof LtiServiceError) {
    return {
      success: false,
      error: new LtiServiceError({
        code: error.code,
        serviceKind,
        operation,
        message: error.message,
        cause: error,
        endpointType: error.endpointType,
        status: error.status,
        statusText: error.statusText,
        responseBodySummary: error.responseBodySummary,
      }),
    };
  }

  const message = formatError(error);

  return {
    success: false,
    error: new LtiServiceError({
      code: 'platform_request_failed',
      serviceKind,
      operation,
      message,
      cause: error,
    }),
  };
};

const ltiServicePreconditionFailure = <T>(input: {
  code: Extract<LtiServiceErrorCode, 'service_not_available' | 'missing_required_scope'>;
  serviceKind: LtiServiceKind;
  operation: string;
  message: string;
}): LtiServiceResult<T> => ({
  success: false,
  error: new LtiServiceError(input),
});

const platformResponseInvalid = <T>(
  serviceKind: LtiServiceKind,
  operation: string,
  error: unknown,
): LtiServiceResult<T> => ({
  success: false,
  error: new LtiServiceError({
    code: 'platform_response_invalid',
    serviceKind,
    operation,
    message: formatError(error),
    cause: error,
  }),
});

/**
 * Main LTI 1.3 Tool implementation providing secure authentication, launch verification,
 * and LTI Advantage services integration.
 *
 * @example
 * ```typescript
 * const ltiTool = new LTITool({
 *   stateSecret: new TextEncoder().encode('your-secret'),
 *   keyPair: await generateKeyPair('RS256'),
 *   storage: new MemoryStorage()
 * });
 *
 * // Handle login initiation
 * const authUrl = await ltiTool.handleLogin({
 *   client_id: 'your-client-id',
 *   iss: 'https://platform.example.com',
 *   launchUrl: 'https://yourtool.com/lti/launch',
 *   login_hint: 'user123',
 *   target_link_uri: 'https://yourtool.com/content',
 *   lti_deployment_id: 'deployment123'
 * });
 * ```
 */
export class LTITool {
  /** Cache for JWKS remote key sets to improve performance */
  private jwksCache: LtiLaunchJwksCache = new Map();
  private verifiedLaunchClientIds = new WeakMap<LTI13JwtPayload, string>();
  private logger: Logger;
  private tokenService: TokenService;
  private agsService: AGSService;
  private nrpsService: NRPSService;
  private deepLinkingService: DeepLinkingService;
  private dynamicRegistrationService?: DynamicRegistrationService;

  /**
   * Creates a new LTI Tool instance.
   *
   * @param config - Configuration object containing secrets, keys, and storage adapter
   */
  constructor(private config: LTIConfig) {
    this.logger =
      config.logger ??
      ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      } as unknown as Logger);

    this.tokenService = new TokenService(
      this.config.keyPair,
      this.config.security?.keyId ?? 'main',
    );
    this.agsService = new AGSService(this.tokenService, this.config.storage, this.logger);
    this.nrpsService = new NRPSService(
      this.tokenService,
      this.config.storage,
      this.logger,
    );
    this.deepLinkingService = new DeepLinkingService(
      this.config.keyPair,
      this.logger,
      this.config.security?.keyId ?? 'main',
    );
    if (this.config.dynamicRegistration) {
      this.dynamicRegistrationService = new DynamicRegistrationService(
        this.config.storage,
        this.config.dynamicRegistration,
        this.logger,
      );
    }
  }

  /**
   * Handles LTI 1.3 login initiation by generating state/nonce and redirecting to platform auth.
   *
   * @param params - Login parameters from the platform
   * @param params.client_id - OAuth2 client identifier for this tool
   * @param params.iss - Platform issuer URL (identifies the LMS)
   * @param params.launchUrl - URL where platform will POST the id_token after auth
   * @param params.login_hint - Platform-specific user identifier hint
   * @param params.target_link_uri - Final destination URL after successful launch
   * @param params.lti_deployment_id - Deployment identifier within the platform
   * @param params.lti_message_hint - Optional platform-specific message context
   * @returns Authorization URL to redirect user to for authentication
   * @throws {Error} When platform configuration is not found
   */
  async handleLogin(params: {
    client_id: string;
    iss: string;
    launchUrl: URL | string;
    login_hint: string;
    target_link_uri: string;
    lti_deployment_id: string;
    lti_message_hint?: string;
  }): Promise<string> {
    try {
      const validatedParams = HandleLoginParamsSchema.parse(params);

      const nonce = crypto.randomUUID();

      // Store nonce with expiration for replay attack prevention
      const nonceExpirationSeconds = this.config.security?.nonceExpirationSeconds ?? 600;
      const nonceExpiresAt = new Date(Date.now() + nonceExpirationSeconds * 1000);
      await this.config.storage.storeNonce(nonce, nonceExpiresAt);

      const state = await new SignJWT({
        nonce,
        iss: validatedParams.iss,
        client_id: validatedParams.client_id,
        target_link_uri: validatedParams.target_link_uri,
        exp:
          Math.floor(Date.now() / 1000) +
          (this.config.security?.stateExpirationSeconds ?? 600),
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(this.config.stateSecret);

      const launchConfig = await getValidLaunchConfig(
        this.config.storage,
        validatedParams.iss,
        validatedParams.client_id,
        validatedParams.lti_deployment_id,
      );

      return buildLtiLoginAuthUrl({
        launchConfig,
        validatedParams,
        state,
        nonce,
      });
    } catch (error) {
      throw new Error(
        `[LTI] Login initiation failed for issuer '${params.iss}', client '${params.client_id}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Verifies and validates an LTI 1.3 launch by checking JWT signatures, nonces, and claims.
   *
   * Performs comprehensive security validation including:
   * - JWT signature verification using platform's JWKS
   * - State JWT verification to prevent CSRF
   * - Nonce validation to prevent replay attacks
   * - Client ID and deployment ID verification
   * - Target link URI binding to the value requested during login initiation
   * - LTI 1.3 claim structure validation
   *
   * @param idToken - JWT id_token received from platform after authentication
   * @param state - State JWT that was generated during login initiation
   * @returns Validated and parsed LTI 1.3 JWT payload
   * @throws {Error} When verification fails for security reasons
   */
  async verifyLaunch(idToken: string, state: string): Promise<LTI13JwtPayload> {
    try {
      const verifiedLaunch = await this.verifyLaunchInternal(idToken, state);
      return verifiedLaunch.payload;
    } catch (error) {
      throw new Error(`[LTI] Launch verification failed: ${formatError(error)}`);
    }
  }

  /**
   * Verifies an LTI 1.3 launch and returns structured success or failure details.
   *
   * This method performs the same security checks as verifyLaunch, but callers receive
   * a stable error code and verified launch context instead of a thrown generic Error.
   */
  async verifyLaunchDetailed(
    idToken: string,
    state: string,
  ): Promise<LtiLaunchVerificationResult>;

  async verifyLaunchDetailed<TAuthorization>(
    idToken: string,
    state: string,
    options: LtiVerifyLaunchDetailedOptions<TAuthorization>,
  ): Promise<LtiLaunchVerificationResult<LtiAuthorizedLaunch<TAuthorization>>>;

  async verifyLaunchDetailed<TAuthorization>(
    idToken: string,
    state: string,
    options?: LtiVerifyLaunchDetailedOptions<TAuthorization>,
  ): Promise<LtiLaunchVerificationResult> {
    try {
      const launch = await this.verifyLaunchInternal(idToken, state);
      if (!options?.authorizeVerifiedLaunch) {
        return { success: true, launch };
      }

      return {
        success: true,
        launch: await authorizeVerifiedLaunch(launch, options.authorizeVerifiedLaunch),
      };
    } catch (error) {
      if (error instanceof LtiLaunchVerificationError) {
        return { success: false, error };
      }

      return {
        success: false,
        error: new LtiLaunchVerificationError(
          'unknown_error',
          `Launch verification failed: ${formatError(error)}`,
          error,
        ),
      };
    }
  }

  private async verifyLaunchInternal(
    idToken: string,
    state: string,
  ): Promise<LtiVerifiedLaunch> {
    const launch = await verifyLtiLaunch({
      idToken,
      state,
      stateSecret: this.config.stateSecret,
      storage: this.config.storage,
      trustedAudiences: this.config.security?.trustedAudiences,
      jwksCache: this.jwksCache,
    });

    this.verifiedLaunchClientIds.set(launch.payload, launch.clientId);
    return launch;
  }

  /**
   * Generates JSON Web Key Set (JWKS) containing the tool's public key for platform verification.
   *
   * @returns JWKS object with the tool's public key for JWT signature verification
   */
  async getJWKS(): Promise<JWKS> {
    try {
      const publicJwk = await exportJWK(this.config.keyPair.publicKey);
      return {
        keys: [
          {
            ...publicJwk,
            use: 'sig',
            alg: 'RS256',
            kid: this.config.security?.keyId ?? 'main',
          },
        ],
      };
    } catch (error) {
      throw new Error(`[LTI] JWKS generation failed: ${formatError(error)}`);
    }
  }

  /**
   * Creates and stores a new LTI session from validated JWT payload.
   *
   * @param lti13JwtPayload - Validated LTI 1.3 JWT payload from successful launch
   * @param clientId - Verified tool client ID when the JWT has multiple audiences. Required if the payload was not returned directly from verifyLaunch on this LTITool instance.
   * @returns Created session object with user, context, and service information
   */
  async createSession(
    lti13JwtPayload: LTI13JwtPayload,
    clientId?: string,
  ): Promise<LTISession> {
    try {
      const session = createSession(lti13JwtPayload, {
        clientId: clientId ?? this.verifiedLaunchClientIds.get(lti13JwtPayload),
      });
      await this.config.storage.addSession(session);
      return session;
    } catch (error) {
      throw new Error(
        `[Session] Creation failed for user '${lti13JwtPayload.sub}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Creates and stores a new LTI session from a previously verified launch.
   *
   * This is the recommended session creation path after verifyLaunchDetailed(), because it
   * preserves the verified client ID for multi-audience launch tokens.
   *
   * @param launch - Verified launch returned by verifyLaunchDetailed()
   * @returns Created session object with user, context, and service information
   */
  async createSessionFromVerifiedLaunch(launch: LtiVerifiedLaunch): Promise<LTISession> {
    return await this.createSession(launch.payload, launch.clientId);
  }

  /**
   * Retrieves an existing LTI session by session ID.
   *
   * @param sessionId - Unique session identifier
   * @returns Session object if found, undefined otherwise
   */
  async getSession(sessionId: string): Promise<LTISession | undefined> {
    try {
      const validatedSessionId = SessionIdSchema.parse(sessionId);
      return await this.config.storage.getSession(validatedSessionId);
    } catch (error) {
      throw new Error(
        `[Session] Retrieval failed for ID '${sessionId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Submits a grade score to the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param score - Score submission data including grade value and user ID
   * @throws {Error} When AGS is not available or submission fails
   */
  async submitScore(session: LTISession, score: ScoreSubmission): Promise<void> {
    if (!session) {
      throw new Error('session is required');
    }
    if (!score) {
      throw new Error('score is required');
    }

    try {
      await this.agsService.submitScore(session, score);
    } catch (error) {
      throw new Error(
        `[AGS] Score submission failed for user '${score.userId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Submits a grade score and returns a structured result instead of throwing.
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param score - Score submission data including grade value and user ID
   * @returns Structured success or stable service error result
   */
  async submitScoreDetailed(
    session: LTISession,
    score: ScoreSubmission,
  ): Promise<LtiServiceResult<void>> {
    if (!session.services?.ags?.lineitem) {
      return ltiServicePreconditionFailure({
        code: 'service_not_available',
        serviceKind: 'ags',
        operation: 'submitScore',
        message: 'AGS line item service is not available for this session',
      });
    }

    if (!session.services.ags.scopes.includes(LTI_AGS_SCOPE_SCORE)) {
      return ltiServicePreconditionFailure({
        code: 'missing_required_scope',
        serviceKind: 'ags',
        operation: 'submitScore',
        message: `Missing required AGS scope '${LTI_AGS_SCOPE_SCORE}'`,
      });
    }

    try {
      const response = await this.agsService.submitScore(session, score);
      return { success: true, data: undefined, response };
    } catch (error) {
      return ltiServiceFailure(error, 'ags', 'submitScore');
    }
  }

  /**
   * Retrieves all scores for a specific line item from the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param options - Optional line item target override and AGS result filters
   * @returns Array of score submissions for the line item
   * @throws {Error} When AGS is not available or request fails
   *
   * @example
   * ```typescript
   * const scores = await ltiTool.getScores(session);
   * console.log('All scores:', scores.map(s => `${s.userId}: ${s.scoreGiven}`));
   * ```
   */
  async getScores(
    session: LTISession,
    options: AGSGetScoresOptions = {},
  ): Promise<Results> {
    if (!session) {
      throw new Error('session is required');
    }

    try {
      const response = await this.agsService.getScores(session, options);
      const data = await response.json();
      return ResultsSchema.parse(data);
    } catch (error) {
      throw new Error(
        `[AGS] Scores retrieval failed for session '${session.id}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Retrieves line items (gradebook columns) from the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param options - Optional AGS line item list filters
   * @returns Array of line items from the platform
   * @throws {Error} When AGS is not available or request fails
   */
  async listLineItems(
    session: LTISession,
    options: AGSListLineItemsOptions = {},
  ): Promise<LineItems> {
    if (!session) {
      throw new Error('session is required');
    }

    try {
      const response = await this.agsService.listLineItems(session, options);
      const data = await response.json();
      return LineItemsSchema.parse(data);
    } catch (error) {
      throw new Error(
        `[AGS] Line items listing failed for session '${session.id}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Retrieves a specific line item (gradebook column) from the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @returns Line item data from the platform
   * @throws {Error} When AGS is not available or request fails
   */
  async getLineItem(
    session: LTISession,
    options: AGSLineItemTargetOptions = {},
  ): Promise<LineItem> {
    if (!session) {
      throw new Error('session is required');
    }

    try {
      const response = await this.agsService.getLineItem(session, options);
      const data = await response.json();
      return LineItemSchema.parse(data);
    } catch (error) {
      throw new Error(
        `[AGS] Line item retrieval failed for session '${session.id}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Creates a new line item (gradebook column) on the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param createLineItem - Line item data including label, scoreMaximum, and optional metadata
   * @returns Created line item with platform-generated ID and validated data
   * @throws {Error} When AGS is not available, input validation fails, or creation fails
   *
   * @example
   * ```typescript
   * const newLineItem = await ltiTool.createLineItem(session, {
   *   label: 'Quiz 1',
   *   scoreMaximum: 100,
   *   tag: 'quiz',
   *   resourceId: 'quiz-001'
   * });
   * console.log('Created line item:', newLineItem.id);
   * ```
   */
  async createLineItem(
    session: LTISession,
    createLineItem: CreateLineItem,
  ): Promise<LineItem> {
    if (!session) {
      throw new Error('session is required');
    }
    if (!createLineItem) {
      throw new Error('createLineItem is required');
    }

    try {
      const response = await this.agsService.createLineItem(session, createLineItem);
      const data = await response.json();
      return LineItemSchema.parse(data);
    } catch (error) {
      throw new Error(
        `[AGS] Line item creation failed for '${createLineItem.label}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Updates an existing line item (gradebook column) on the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param updateLineItem - Updated line item data including all required fields
   * @returns Updated line item with validated data from the platform
   * @throws {Error} When AGS is not available, input validation fails, or update fails
   */
  async updateLineItem(
    session: LTISession,
    updateLineItem: UpdateLineItem,
  ): Promise<LineItem> {
    if (!session) {
      throw new Error('session is required');
    }
    if (!updateLineItem) {
      throw new Error('lineItem is required');
    }

    try {
      const response = await this.agsService.updateLineItem(session, updateLineItem);
      const data = await response.json();
      return LineItemSchema.parse(data);
    } catch (error) {
      throw new Error(
        `[AGS] Line item update failed for '${updateLineItem.label}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Deletes a line item (gradebook column) from the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @throws {Error} When AGS is not available or deletion fails
   */
  async deleteLineItem(session: LTISession): Promise<void> {
    if (!session) {
      throw new Error('session is required');
    }

    try {
      await this.agsService.deleteLineItem(session);
    } catch (error) {
      throw new Error(
        `[AGS] Line item deletion failed for session '${session.id}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Retrieves course/context members using Names and Role Provisioning Services (NRPS).
   *
   * @param session - Active LTI session containing NRPS service endpoints
   * @returns Array of members with clean camelCase properties
   * @throws {Error} When NRPS is not available or request fails
   *
   * @example
   * ```typescript
   * const members = await ltiTool.getMembers(session);
   * const instructors = members.filter(m =>
   *   m.roles.some(role => role.includes('Instructor'))
   * );
   * ```
   */
  async getMembers(session: LTISession): Promise<Member[]> {
    if (!session) {
      throw new Error('session is required');
    }

    try {
      const response = await this.nrpsService.getMembers(session);
      const data = await response.json();
      return normalizeLtiNrpsMembersResponse(data);
    } catch (error) {
      throw new Error(
        `[NRPS] Members retrieval failed for session '${session.id}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Retrieves course/context members and returns a structured result instead of throwing.
   *
   * @param session - Active LTI session containing NRPS service endpoints
   * @returns Structured success with normalized members or stable service error result
   */
  async getMembersDetailed(session: LTISession): Promise<LtiServiceResult<Member[]>> {
    if (!session.services?.nrps?.membershipUrl) {
      return ltiServicePreconditionFailure({
        code: 'service_not_available',
        serviceKind: 'nrps',
        operation: 'getMembers',
        message: 'NRPS membership service is not available for this session',
      });
    }

    try {
      const response = await this.nrpsService.getMembers(session);
      const data: unknown = await response.json();

      try {
        return {
          success: true,
          data: normalizeLtiNrpsMembersResponse(data),
          response,
        };
      } catch (error) {
        return platformResponseInvalid('nrps', 'getMembers', error);
      }
    } catch (error) {
      return ltiServiceFailure(error, 'nrps', 'getMembers');
    }
  }

  /**
   * Creates a Deep Linking response with selected content items.
   * Generates a signed JWT and returns HTML form that auto-submits to the platform.
   *
   * @param session - Active LTI session containing Deep Linking configuration
   * @param contentItems - Array of content items selected by the user
   * @returns HTML string containing auto-submit form
   * @throws {Error} When Deep Linking is not available for the session
   *
   * @example
   * ```typescript
   * const html = await ltiTool.createDeepLinkingResponse(session, [
   *   {
   *     type: 'ltiResourceLink',
   *     title: 'Quiz 1',
   *     url: 'https://tool.example.com/quiz/1'
   *   }
   * ]);
   * // Render the HTML to return content items to platform
   * ```
   */
  async createDeepLinkingResponse(
    session: LTISession,
    contentItems: DeepLinkingContentItem[],
  ): Promise<string> {
    if (!session) {
      throw new Error('session is required');
    }
    if (!contentItems) {
      throw new Error('contentItems is required');
    }

    try {
      return await this.deepLinkingService.createResponse(session, contentItems);
    } catch (error) {
      throw new Error(
        `[Deep Linking] Response creation failed for session '${session.id}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Fetches and validates the OpenID Connect configuration from an LTI platform during dynamic registration.
   * Validates that the OIDC endpoint and issuer have matching hostnames for security.
   *
   * @param registrationRequest - Registration request containing openid_configuration URL and optional registration_token
   * @returns Validated OpenID configuration with platform endpoints and supported features
   * @throws {Error} When the configuration fetch fails, validation fails, or hostname mismatch detected
   *
   * @example
   * ```typescript
   * const config = await ltiTool.fetchPlatformConfiguration({
   *   openid_configuration: 'https://platform.edu/.well-known/openid_configuration',
   *   registration_token: 'optional-bearer-token'
   * });
   * console.log('Platform issuer:', config.issuer);
   * ```
   */
  async fetchPlatformConfiguration(
    registrationRequest: RegistrationRequest,
  ): Promise<OpenIDConfiguration> {
    if (!this.dynamicRegistrationService) {
      throw new Error('Dynamic registration service is not configured');
    }
    try {
      return await this.dynamicRegistrationService.fetchPlatformConfiguration(
        registrationRequest,
      );
    } catch (error) {
      throw new Error(
        `[Dynamic Registration] Platform configuration fetch failed: ${formatError(error)}`,
      );
    }
  }

  /**
   * Initiates LTI 1.3 dynamic registration by fetching platform configuration and generating registration form.
   * Creates a temporary session and returns vendor-specific HTML form for service selection.
   *
   * @param registrationRequest - Registration request containing openid_configuration URL and optional registration_token
   * @param requestPath - Current request path used to build form action URLs
   * @returns HTML form for service selection and registration completion
   * @throws {Error} When dynamic registration service is not configured or platform configuration fails
   */
  async initiateDynamicRegistration(
    registrationRequest: RegistrationRequest,
    requestPath: string,
  ): Promise<string> {
    if (!this.dynamicRegistrationService) {
      throw new Error('Dynamic registration service is not configured');
    }
    try {
      return await this.dynamicRegistrationService.initiateDynamicRegistration(
        registrationRequest,
        requestPath,
      );
    } catch (error) {
      throw new Error(`[Dynamic Registration] Initiation failed: ${formatError(error)}`);
    }
  }

  /**
   * Completes LTI 1.3 dynamic registration by processing form submission and storing client configuration.
   * Validates session, registers with platform, stores client/deployment data, and returns success page.
   *
   * @param dynamicRegistrationForm - Validated form data containing selected services and session token
   * @returns HTML success page with registration details and close button
   * @throws {Error} When dynamic registration service is not configured or registration process fails
   */
  async completeDynamicRegistration(
    dynamicRegistrationForm: DynamicRegistrationForm,
  ): Promise<string> {
    if (!this.dynamicRegistrationService) {
      throw new Error('Dynamic registration service is not configured');
    }

    try {
      return await this.dynamicRegistrationService.completeDynamicRegistration(
        dynamicRegistrationForm,
      );
    } catch (error) {
      throw new Error(`[Dynamic Registration] Completion failed: ${formatError(error)}`);
    }
  }

  /**
   * Completes dynamic registration and returns the stored registration records.
   *
   * @param dynamicRegistrationForm - Validated form data containing selected services and session token
   * @returns HTML response plus stored client, deployment, launch config, and created flags
   * @throws {Error} When dynamic registration service is not configured or registration process fails
   */
  async completeDynamicRegistrationDetailed(
    dynamicRegistrationForm: DynamicRegistrationForm,
  ): Promise<LtiDynamicRegistrationCompletionResult> {
    if (!this.dynamicRegistrationService) {
      throw new Error('Dynamic registration service is not configured');
    }

    try {
      return await this.dynamicRegistrationService.completeDynamicRegistrationDetailed(
        dynamicRegistrationForm,
      );
    } catch (error) {
      throw new Error(`[Dynamic Registration] Completion failed: ${formatError(error)}`);
    }
  }

  // Client management

  /**
   * Retrieves all configured LTI client platforms.
   *
   * @returns Array of client configurations (without deployment details)
   */
  async listClients(): Promise<Omit<LTIClient, 'deployments'>[]> {
    try {
      return await this.config.storage.listClients();
    } catch (error) {
      throw new Error(`[Client] Listing failed: ${formatError(error)}`);
    }
  }

  /**
   * Updates an existing client configuration.
   *
   * @param clientId - Unique client identifier
   * @param client - Partial client object with fields to update
   */
  async updateClient(
    clientId: string,
    client: Partial<Omit<LTIClient, 'id' | 'deployments'>>,
  ): Promise<void> {
    try {
      const validated = UpdateClientSchema.parse(client);
      return await this.config.storage.updateClient(clientId, validated);
    } catch (error) {
      throw new Error(
        `[Client] Update failed for ID '${clientId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Retrieves a specific client configuration by ID.
   *
   * @param clientId - Unique client identifier
   * @returns Client configuration if found, undefined otherwise
   */
  async getClientById(clientId: string): Promise<LTIClient | undefined> {
    try {
      return await this.config.storage.getClientById(clientId);
    } catch (error) {
      throw new Error(
        `[Client] Retrieval failed for ID '${clientId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Adds a new LTI client platform configuration.
   *
   * @param client - Client configuration (ID will be auto-generated)
   * @returns The generated client ID
   */
  async addClient(client: Omit<LTIClient, 'id' | 'deployments'>): Promise<string> {
    try {
      const validated = AddClientSchema.parse(client);
      return await this.config.storage.addClient(validated);
    } catch (error) {
      throw new Error(
        `[Client] Creation failed for issuer '${client.iss}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Adds or updates launch registration records using platform identifiers.
   *
   * This helper matches clients by issuer and OAuth client ID, matches deployments by
   * the LMS-provided deployment ID under the stored client, and saves the launch
   * configuration used by OIDC login and launch verification.
   *
   * @param registration - Platform identifiers and launch endpoints
   * @returns Stored client, deployment, launch config, and created flags
   */
  async upsertLaunchRegistration(
    registration: LtiLaunchRegistrationInput,
  ): Promise<LtiLaunchRegistrationUpsertResult> {
    try {
      const { client, createdClient } = await upsertLaunchRegistrationClient(
        this.config.storage,
        registration,
      );
      const { deployment, deployments, createdDeployment } =
        await upsertLaunchRegistrationDeployment(
          this.config.storage,
          client.id,
          registration,
        );
      const launchConfig = launchConfigFromRegistration(registration);
      await this.config.storage.saveLaunchConfig(launchConfig);

      return {
        client: { ...client, deployments },
        deployment,
        launchConfig,
        createdClient,
        createdDeployment,
      };
    } catch (error) {
      throw new Error(
        `[Launch Registration] Upsert failed for issuer '${registration.iss}', client '${registration.clientId}', deployment '${registration.deploymentId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Removes a client configuration and all its deployments.
   *
   * @param clientId - Unique client identifier
   */
  async deleteClient(clientId: string): Promise<void> {
    try {
      return await this.config.storage.deleteClient(clientId);
    } catch (error) {
      throw new Error(
        `[Client] Deletion failed for ID '${clientId}': ${formatError(error)}`,
      );
    }
  }

  // Deployment management

  /**
   * Lists all deployments for a specific client platform.
   *
   * @param clientId - Client identifier
   * @returns Array of deployment configurations for the client
   */
  async listDeployments(clientId: string): Promise<LTIDeployment[]> {
    try {
      return await this.config.storage.listDeployments(clientId);
    } catch (error) {
      throw new Error(
        `[Deployment] Listing failed for client '${clientId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Retrieves a specific deployment configuration.
   *
   * @param clientId - Client identifier
   * @param deploymentId - Deployment identifier
   * @returns Deployment configuration if found, undefined otherwise
   */
  async getDeployment(
    clientId: string,
    deploymentId: string,
  ): Promise<LTIDeployment | undefined> {
    try {
      return await this.config.storage.getDeployment(clientId, deploymentId);
    } catch (error) {
      throw new Error(
        `[Deployment] Retrieval failed for client '${clientId}', deployment '${deploymentId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Adds a new deployment to an existing client.
   *
   * @param clientId - Client identifier
   * @param deployment - Deployment configuration to add
   * @returns The generated deployment ID
   */
  async addDeployment(
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ): Promise<string> {
    try {
      return await this.config.storage.addDeployment(clientId, deployment);
    } catch (error) {
      throw new Error(
        `[Deployment] Creation failed for client '${clientId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Updates an existing deployment configuration.
   *
   * @param clientId - Client identifier
   * @param deploymentId - Deployment identifier
   * @param deployment - Partial deployment object with fields to update
   */
  async updateDeployment(
    clientId: string,
    deploymentId: string,
    deployment: Partial<LTIDeployment>,
  ): Promise<void> {
    try {
      return await this.config.storage.updateDeployment(
        clientId,
        deploymentId,
        deployment,
      );
    } catch (error) {
      throw new Error(
        `Deployment update failed for client '${clientId}' and deployment '${deploymentId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Removes a deployment from a client.
   *
   * @param clientId - Client identifier
   * @param deploymentId - Deployment identifier to remove
   */
  async deleteDeployment(clientId: string, deploymentId: string): Promise<void> {
    try {
      return await this.config.storage.deleteDeployment(clientId, deploymentId);
    } catch (error) {
      throw new Error(
        `[Deployment] Deletion failed for client '${clientId}', deployment '${deploymentId}': ${formatError(error)}`,
      );
    }
  }

  // Dynamic Registration Session Management

  /**
   * Stores a temporary registration session during LTI 1.3 dynamic registration flow.
   * Sessions automatically expire after the configured TTL period.
   *
   * @param sessionId - Unique session identifier (typically a UUID)
   * @param session - Registration session data including platform config and tokens
   */
  async setRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    try {
      return await this.config.storage.setRegistrationSession(sessionId, session);
    } catch (error) {
      throw new Error(
        `[Dynamic Registration] Session storage failed for ID '${sessionId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Retrieves a registration session by its ID for validation during completion.
   * Returns undefined if the session is not found or has expired.
   *
   * @param sessionId - Unique session identifier
   * @returns Registration session if found and not expired, undefined otherwise
   */
  async getRegistrationSession(
    sessionId: string,
  ): Promise<LTIDynamicRegistrationSession | undefined> {
    try {
      return await this.config.storage.getRegistrationSession(sessionId);
    } catch (error) {
      throw new Error(
        `[Dynamic Registration] Session retrieval failed for ID '${sessionId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Removes a registration session from storage after completion or expiration.
   * Used for cleanup to prevent session accumulation.
   *
   * @param sessionId - Unique session identifier to delete
   */
  async deleteRegistrationSession(sessionId: string): Promise<void> {
    try {
      return await this.config.storage.deleteRegistrationSession(sessionId);
    } catch (error) {
      throw new Error(
        `[Dynamic Registration] Session deletion failed for ID '${sessionId}': ${formatError(error)}`,
      );
    }
  }
}
