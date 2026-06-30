import { exportJWK, SignJWT } from 'jose';
import type { Logger } from 'pino';

import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_LINEITEM_READONLY,
  LTI_AGS_SCOPE_SCORE,
} from './constants.js';
import {
  LtiServiceError,
  type LtiServiceErrorCode,
  type LtiServiceKind,
  type LtiServiceResult,
} from './errors/ltiServiceError.js';
import type {
  LTIClient,
  LTIDeployment,
  LTIDynamicRegistrationSession,
} from './interfaces/index.js';
import type { JWKS } from './interfaces/jwks.js';
import type { LTIConfig } from './interfaces/ltiConfig.js';
import type { LTISession } from './interfaces/ltiSession.js';
import {
  type LtiLaunchRegistrationInput,
  type LtiLaunchRegistrationUpsertResult,
  upsertLaunchRegistration,
} from './launchRegistration.js';
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
import { createNoopLogger } from './utils/noopLogger.js';
import { normalizeLtiNrpsMembersResponse } from './utils/nrps.js';

export type { LtiLaunchRegistrationInput, LtiLaunchRegistrationUpsertResult };

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

const hasAgsScope = (session: LTISession, scope: string): boolean =>
  session.services?.ags?.scopes.includes(scope) === true;

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
 * await ltiTool.upsertLaunchRegistration({
 *   iss: 'https://platform.example.com',
 *   clientId: 'your-client-id',
 *   deploymentId: 'deployment123',
 *   authUrl: 'https://platform.example.com/auth',
 *   tokenUrl: 'https://platform.example.com/token',
 *   jwksUrl: 'https://platform.example.com/jwks',
 * });
 *
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
    this.logger = config.logger ?? createNoopLogger();

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
   * Retrieves AGS line items and returns a structured result instead of throwing.
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param options - Optional AGS line item list filters
   * @returns Structured success with validated line items or stable service error result
   */
  async listLineItemsDetailed(
    session: LTISession,
    options: AGSListLineItemsOptions = {},
  ): Promise<LtiServiceResult<LineItems>> {
    if (!session.services?.ags?.lineitems) {
      return ltiServicePreconditionFailure({
        code: 'service_not_available',
        serviceKind: 'ags',
        operation: 'listLineItems',
        message: 'AGS line items service is not available for this session',
      });
    }

    if (!hasAgsScope(session, LTI_AGS_SCOPE_LINEITEM_READONLY)) {
      return ltiServicePreconditionFailure({
        code: 'missing_required_scope',
        serviceKind: 'ags',
        operation: 'listLineItems',
        message: `Missing required AGS scope '${LTI_AGS_SCOPE_LINEITEM_READONLY}'`,
      });
    }

    try {
      const response = await this.agsService.listLineItems(session, options);
      const data: unknown = await response.json();

      try {
        return {
          success: true,
          data: LineItemsSchema.parse(data),
          response,
        };
      } catch (error) {
        return platformResponseInvalid('ags', 'listLineItems', error);
      }
    } catch (error) {
      return ltiServiceFailure(error, 'ags', 'listLineItems');
    }
  }

  /**
   * Retrieves a specific line item (gradebook column) from the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param options - Optional line item target override
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
   * Retrieves an AGS line item and returns a structured result instead of throwing.
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param options - Optional line item target override
   * @returns Structured success with a validated line item or stable service error result
   */
  async getLineItemDetailed(
    session: LTISession,
    options: AGSLineItemTargetOptions = {},
  ): Promise<LtiServiceResult<LineItem>> {
    const lineItemUrl = options.lineItemUrl ?? session.services?.ags?.lineitem;

    if (!lineItemUrl) {
      return ltiServicePreconditionFailure({
        code: 'service_not_available',
        serviceKind: 'ags',
        operation: 'getLineItem',
        message: 'AGS line item service is not available for this session',
      });
    }

    if (!hasAgsScope(session, LTI_AGS_SCOPE_LINEITEM_READONLY)) {
      return ltiServicePreconditionFailure({
        code: 'missing_required_scope',
        serviceKind: 'ags',
        operation: 'getLineItem',
        message: `Missing required AGS scope '${LTI_AGS_SCOPE_LINEITEM_READONLY}'`,
      });
    }

    try {
      const response = await this.agsService.getLineItem(session, options);
      const data: unknown = await response.json();

      try {
        return {
          success: true,
          data: LineItemSchema.parse(data),
          response,
        };
      } catch (error) {
        return platformResponseInvalid('ags', 'getLineItem', error);
      }
    } catch (error) {
      return ltiServiceFailure(error, 'ags', 'getLineItem');
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
   * Creates an AGS line item and returns a structured result instead of throwing.
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param createLineItem - Line item data including label, scoreMaximum, and optional metadata
   * @returns Structured success with the validated created line item or stable service error result
   */
  async createLineItemDetailed(
    session: LTISession,
    createLineItem: CreateLineItem,
  ): Promise<LtiServiceResult<LineItem>> {
    if (!session.services?.ags?.lineitems) {
      return ltiServicePreconditionFailure({
        code: 'service_not_available',
        serviceKind: 'ags',
        operation: 'createLineItem',
        message: 'AGS line items service is not available for this session',
      });
    }

    if (!hasAgsScope(session, LTI_AGS_SCOPE_LINEITEM)) {
      return ltiServicePreconditionFailure({
        code: 'missing_required_scope',
        serviceKind: 'ags',
        operation: 'createLineItem',
        message: `Missing required AGS scope '${LTI_AGS_SCOPE_LINEITEM}'`,
      });
    }

    try {
      const response = await this.agsService.createLineItem(session, createLineItem);
      const data: unknown = await response.json();

      try {
        return {
          success: true,
          data: LineItemSchema.parse(data),
          response,
        };
      } catch (error) {
        return platformResponseInvalid('ags', 'createLineItem', error);
      }
    } catch (error) {
      return ltiServiceFailure(error, 'ags', 'createLineItem');
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

  /**
   * Retrieves all configured LTI client platforms.
   *
   * @returns Client configurations without deployment details.
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
   * @param clientId - Stored client identifier.
   * @param client - Partial client fields to update.
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
   * Retrieves a client configuration by stored client identifier.
   *
   * @param clientId - Stored client identifier.
   * @returns Client configuration with deployments, when found.
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
   * Adds an LTI client platform configuration.
   *
   * Application code should prefer {@link LTITool.upsertLaunchRegistration} or dynamic
   * registration. Use this for custom admin UIs that manage stored client records directly.
   *
   * @param client - Client configuration. The storage adapter generates the ID.
   * @returns Generated stored client identifier.
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
   * Registers or updates a platform for launch verification using LMS administrator values.
   *
   * This is the recommended registration path for application code. It upserts the client
   * and deployment, then refreshes the cached launch config used on the hot launch path.
   *
   * @param registration - Platform identifiers and launch endpoints from the LMS.
   * @returns Stored client, deployment, launch config, and created flags.
   */
  async upsertLaunchRegistration(
    registration: LtiLaunchRegistrationInput,
  ): Promise<LtiLaunchRegistrationUpsertResult> {
    try {
      return await upsertLaunchRegistration(this.config.storage, registration);
    } catch (error) {
      throw new Error(
        `[Launch Registration] Upsert failed for issuer '${registration.iss}', client '${registration.clientId}', deployment '${registration.deploymentId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Deletes a client platform configuration.
   *
   * @param clientId - Stored client identifier.
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

  /**
   * Lists deployments for a stored client.
   *
   * @param clientId - Stored client identifier.
   * @returns Deployment configurations for the client.
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
   * Retrieves a deployment by the platform-provided deployment ID.
   *
   * @param clientId - Stored client identifier.
   * @param deploymentId - Platform-provided deployment identifier.
   * @returns Deployment configuration, when found.
   */
  async getDeploymentByPlatformId(
    clientId: string,
    deploymentId: string,
  ): Promise<LTIDeployment | undefined> {
    try {
      return await this.config.storage.getDeploymentByPlatformId(clientId, deploymentId);
    } catch (error) {
      throw new Error(
        `[Deployment] Retrieval failed for client '${clientId}', deployment '${deploymentId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Adds a deployment under a stored client.
   *
   * Application code should prefer {@link LTITool.upsertLaunchRegistration}. Use this for
   * custom admin UIs that manage stored deployment records directly.
   *
   * @param clientId - Stored client identifier.
   * @param deployment - Deployment configuration. The storage adapter generates the ID.
   * @returns Generated stored deployment identifier.
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
   * Updates a deployment by stored deployment identifier.
   *
   * @param clientId - Stored client identifier.
   * @param deploymentId - Stored deployment identifier.
   * @param deployment - Partial deployment fields to update.
   */
  async updateDeploymentById(
    clientId: string,
    deploymentId: string,
    deployment: Partial<LTIDeployment>,
  ): Promise<void> {
    try {
      return await this.config.storage.updateDeploymentById(
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
   * Deletes a deployment by stored deployment identifier.
   *
   * @param clientId - Stored client identifier.
   * @param deploymentId - Stored deployment identifier.
   */
  async deleteDeploymentById(clientId: string, deploymentId: string): Promise<void> {
    try {
      return await this.config.storage.deleteDeploymentById(clientId, deploymentId);
    } catch (error) {
      throw new Error(
        `[Deployment] Deletion failed for client '${clientId}', deployment '${deploymentId}': ${formatError(error)}`,
      );
    }
  }

  /**
   * Stores a dynamic registration session.
   *
   * @param sessionId - Registration session identifier.
   * @param session - Registration session payload.
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
   * Retrieves a dynamic registration session.
   *
   * @param sessionId - Registration session identifier.
   * @returns Registration session payload, when found and unexpired.
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
   * Deletes a dynamic registration session.
   *
   * @param sessionId - Registration session identifier.
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
