import { exportJWK, SignJWT } from 'jose';
import type { Logger } from 'pino';

import {
  ltiServicePreconditionFailure,
  runLtiServiceOperation,
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
} from './launchRegistration.js';
import { LtiToolAdminServices } from './ltiTool.adminServices.js';
import { LtiToolPlatformServices } from './ltiTool.platformServices.js';
import {
  type DynamicRegistrationForm,
  HandleLoginParamsSchema,
  type RegistrationRequest,
  SessionIdSchema,
} from './schemas/index.js';
import {
  type CreateLineItem,
  type LineItem,
  type LineItems,
  type UpdateLineItem,
} from './schemas/lti13/ags/lineItem.schema.js';
import { type Results } from './schemas/lti13/ags/result.schema.js';
import { type ScoreSubmission } from './schemas/lti13/ags/scoreSubmission.schema.js';
import { type DeepLinkingContentItem } from './schemas/lti13/deepLinking/contentItem.schema.js';
import { type OpenIDConfiguration } from './schemas/lti13/dynamicRegistration/openIDConfiguration.schema.js';
import { type Member } from './schemas/lti13/nrps/contextMembership.schema.js';
import {
  type AGSGetScoresOptions,
  type AGSLineItemTargetOptions,
  type AGSListLineItemsOptions,
} from './services/ags.service.js';
import { DeepLinkingService } from './services/deepLinking.service.js';
import {
  DynamicRegistrationService,
  type LtiDynamicRegistrationCompletionResult,
} from './services/dynamicRegistration.service.js';
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
  type LtiVerifyLaunchOptions,
  type LtiVerifiedLaunch,
  verifyLtiLaunch,
} from './utils/ltiLaunchVerification.js';
import { buildLtiLoginAuthUrl } from './utils/ltiLogin.js';
import { createNoopLogger } from './utils/noopLogger.js';

export type { LtiLaunchRegistrationInput, LtiLaunchRegistrationUpsertResult };

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
  private logger: Logger;
  private tokenService: TokenService;
  private platformServices: LtiToolPlatformServices;
  private adminServices: LtiToolAdminServices;
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
    this.platformServices = new LtiToolPlatformServices(
      this.tokenService,
      this.config.storage,
      this.logger,
    );
    this.adminServices = new LtiToolAdminServices(this.config.storage);
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
   * Verifies an LTI 1.3 launch and returns structured success or failure details.
   *
   * Performs JWT, state, nonce, client, deployment, target URI, and claim validation.
   * Callers receive a stable error code and verified launch context.
   */
  async verifyLaunch(
    idToken: string,
    state: string,
  ): Promise<LtiLaunchVerificationResult>;

  async verifyLaunch<TAuthorization>(
    idToken: string,
    state: string,
    options: LtiVerifyLaunchOptions<TAuthorization>,
  ): Promise<LtiLaunchVerificationResult<LtiAuthorizedLaunch<TAuthorization>>>;

  async verifyLaunch<TAuthorization>(
    idToken: string,
    state: string,
    options?: LtiVerifyLaunchOptions<TAuthorization>,
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
   * Creates and stores a new LTI session from a previously verified launch.
   *
   * This preserves the verified client ID for multi-audience launch tokens.
   *
   * @param launch - Verified launch returned by verifyLaunch()
   * @returns Created session object with user, context, and service information
   */
  async createSessionFromVerifiedLaunch(launch: LtiVerifiedLaunch): Promise<LTISession> {
    try {
      const session = createSession(launch.payload, {
        clientId: launch.clientId,
      });
      await this.config.storage.addSession(session);
      return session;
    } catch (error) {
      throw new Error(
        `[Session] Creation failed for user '${launch.payload.sub}': ${formatError(error)}`,
      );
    }
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
   * @returns Structured success or stable service error result
   */
  async submitScore(
    session: LTISession,
    score: ScoreSubmission,
  ): Promise<LtiServiceResult<void>> {
    return await this.platformServices.submitScore(session, score);
  }

  /**
   * Retrieves all scores for a specific line item from the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param options - Optional line item target override and AGS result filters
   * @returns Structured success with validated score results or stable service error result
   *
   * @example
   * ```typescript
   * const result = await ltiTool.getScores(session);
   * if (result.success) console.log('All scores:', result.data);
   * ```
   */
  async getScores(
    session: LTISession,
    options: AGSGetScoresOptions = {},
  ): Promise<LtiServiceResult<Results>> {
    return await this.platformServices.getScores(session, options);
  }

  /**
   * Retrieves line items (gradebook columns) from the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param options - Optional AGS line item list filters
   * @returns Structured success with validated line items or stable service error result
   */
  async listLineItems(
    session: LTISession,
    options: AGSListLineItemsOptions = {},
  ): Promise<LtiServiceResult<LineItems>> {
    return await this.platformServices.listLineItems(session, options);
  }

  /**
   * Retrieves a specific line item (gradebook column) from the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param options - Optional line item target override
   * @returns Structured success with a validated line item or stable service error result
   */
  async getLineItem(
    session: LTISession,
    options: AGSLineItemTargetOptions = {},
  ): Promise<LtiServiceResult<LineItem>> {
    return await this.platformServices.getLineItem(session, options);
  }

  /**
   * Creates a new line item (gradebook column) on the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param createLineItem - Line item data including label, scoreMaximum, and optional metadata
   * @returns Structured success with the validated created line item or stable service error result
   *
   * @example
   * ```typescript
   * const result = await ltiTool.createLineItem(session, {
   *   label: 'Quiz 1',
   *   scoreMaximum: 100,
   *   tag: 'quiz',
   *   resourceId: 'quiz-001'
   * });
   * if (result.success) console.log('Created line item:', result.data.id);
   * ```
   */
  async createLineItem(
    session: LTISession,
    createLineItem: CreateLineItem,
  ): Promise<LtiServiceResult<LineItem>> {
    return await this.platformServices.createLineItem(session, createLineItem);
  }

  /**
   * Updates an existing line item (gradebook column) on the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @param updateLineItem - Updated line item data including all required fields
   * @returns Structured success with the validated updated line item or stable service error result
   */
  async updateLineItem(
    session: LTISession,
    updateLineItem: UpdateLineItem,
  ): Promise<LtiServiceResult<LineItem>> {
    return await this.platformServices.updateLineItem(session, updateLineItem);
  }

  /**
   * Deletes a line item (gradebook column) from the platform using Assignment and Grade Services (AGS).
   *
   * @param session - Active LTI session containing AGS service endpoints
   * @returns Structured success or stable service error result
   */
  async deleteLineItem(session: LTISession): Promise<LtiServiceResult<void>> {
    return await this.platformServices.deleteLineItem(session);
  }

  /**
   * Retrieves course/context members using Names and Role Provisioning Services (NRPS).
   *
   * @param session - Active LTI session containing NRPS service endpoints
   * @returns Structured success with normalized members or stable service error result
   *
   * @example
   * ```typescript
   * const result = await ltiTool.getMembers(session);
   * if (!result.success) return;
   * const instructors = result.data.filter(m =>
   *   m.roles.some(role => role.includes('Instructor'))
   * );
   * ```
   */
  async getMembers(session: LTISession): Promise<LtiServiceResult<Member[]>> {
    return await this.platformServices.getMembers(session);
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
   * @returns Structured success with validated OpenID configuration or a stable service error
   *
   * @example
   * ```typescript
   * const result = await ltiTool.fetchPlatformConfiguration({
   *   openid_configuration: 'https://platform.edu/.well-known/openid_configuration',
   *   registration_token: 'optional-bearer-token'
   * });
   * if (result.success) console.log('Platform issuer:', result.data.issuer);
   * ```
   */
  async fetchPlatformConfiguration(
    registrationRequest: RegistrationRequest,
  ): Promise<LtiServiceResult<OpenIDConfiguration>> {
    if (!this.dynamicRegistrationService) {
      return ltiServicePreconditionFailure({
        code: 'service_not_available',
        serviceKind: 'dynamic_registration',
        operation: 'fetchPlatformConfiguration',
        message: 'Dynamic registration service is not configured',
      });
    }
    const service = this.dynamicRegistrationService;

    return await runLtiServiceOperation({
      serviceKind: 'dynamic_registration',
      operation: 'fetchPlatformConfiguration',
      execute: () => service.fetchPlatformConfiguration(registrationRequest),
    });
  }

  /**
   * Initiates LTI 1.3 dynamic registration by fetching platform configuration and generating registration form.
   * Creates a temporary session and returns vendor-specific HTML form for service selection.
   *
   * @param registrationRequest - Registration request containing openid_configuration URL and optional registration_token
   * @param requestPath - Current request path used to build form action URLs
   * @returns Structured success with the HTML form for service selection or a stable service error
   */
  async initiateDynamicRegistration(
    registrationRequest: RegistrationRequest,
    requestPath: string,
  ): Promise<LtiServiceResult<string>> {
    if (!this.dynamicRegistrationService) {
      return ltiServicePreconditionFailure({
        code: 'service_not_available',
        serviceKind: 'dynamic_registration',
        operation: 'initiateDynamicRegistration',
        message: 'Dynamic registration service is not configured',
      });
    }
    const service = this.dynamicRegistrationService;

    return await runLtiServiceOperation({
      serviceKind: 'dynamic_registration',
      operation: 'initiateDynamicRegistration',
      execute: () =>
        service.initiateDynamicRegistration(registrationRequest, requestPath),
    });
  }

  /**
   * Completes LTI 1.3 dynamic registration by processing form submission and storing client configuration.
   * Validates session, registers with platform, stores client/deployment data, and returns success page.
   *
   * @param dynamicRegistrationForm - Validated form data containing selected services and session token
   * @returns Structured success with HTML response plus stored registration records, or a stable service error
   */
  async completeDynamicRegistration(
    dynamicRegistrationForm: DynamicRegistrationForm,
  ): Promise<LtiServiceResult<LtiDynamicRegistrationCompletionResult>> {
    if (!this.dynamicRegistrationService) {
      return ltiServicePreconditionFailure({
        code: 'service_not_available',
        serviceKind: 'dynamic_registration',
        operation: 'completeDynamicRegistration',
        message: 'Dynamic registration service is not configured',
      });
    }
    const service = this.dynamicRegistrationService;

    return await runLtiServiceOperation({
      serviceKind: 'dynamic_registration',
      operation: 'completeDynamicRegistration',
      execute: () => service.completeDynamicRegistration(dynamicRegistrationForm),
    });
  }

  /**
   * Retrieves all configured LTI client platforms.
   *
   * @returns Client configurations without deployment details.
   */
  async listClients(): Promise<Omit<LTIClient, 'deployments'>[]> {
    return await this.adminServices.listClients();
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
    return await this.adminServices.updateClient(clientId, client);
  }

  /**
   * Retrieves a client configuration by stored client identifier.
   *
   * @param clientId - Stored client identifier.
   * @returns Client configuration with deployments, when found.
   */
  async getClientById(clientId: string): Promise<LTIClient | undefined> {
    return await this.adminServices.getClientById(clientId);
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
    return await this.adminServices.addClient(client);
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
    return await this.adminServices.upsertLaunchRegistration(registration);
  }

  /**
   * Deletes a client platform configuration.
   *
   * @param clientId - Stored client identifier.
   */
  async deleteClient(clientId: string): Promise<void> {
    return await this.adminServices.deleteClient(clientId);
  }

  /**
   * Lists deployments for a stored client.
   *
   * @param clientId - Stored client identifier.
   * @returns Deployment configurations for the client.
   */
  async listDeployments(clientId: string): Promise<LTIDeployment[]> {
    return await this.adminServices.listDeployments(clientId);
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
    return await this.adminServices.getDeploymentByPlatformId(clientId, deploymentId);
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
    return await this.adminServices.addDeployment(clientId, deployment);
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
    return await this.adminServices.updateDeploymentById(
      clientId,
      deploymentId,
      deployment,
    );
  }

  /**
   * Deletes a deployment by stored deployment identifier.
   *
   * @param clientId - Stored client identifier.
   * @param deploymentId - Stored deployment identifier.
   */
  async deleteDeploymentById(clientId: string, deploymentId: string): Promise<void> {
    return await this.adminServices.deleteDeploymentById(clientId, deploymentId);
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
    return await this.adminServices.setRegistrationSession(sessionId, session);
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
    return await this.adminServices.getRegistrationSession(sessionId);
  }

  /**
   * Deletes a dynamic registration session.
   *
   * @param sessionId - Registration session identifier.
   */
  async deleteRegistrationSession(sessionId: string): Promise<void> {
    return await this.adminServices.deleteRegistrationSession(sessionId);
  }
}
