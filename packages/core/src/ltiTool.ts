import { exportJWK, SignJWT } from 'jose';

import type { JWKS } from './interfaces/jwks.js';
import type { LTIConfig } from './interfaces/ltiConfig.js';
import type { LtiLogger } from './interfaces/ltiLogger.js';
import type { LTISession } from './interfaces/ltiSession.js';
import { LtiAdvantage } from './ltiAdvantage.js';
import { HandleLoginParamsSchema, SessionIdSchema } from './schemas/index.js';
import { createSession } from './services/session.service.js';
import { TokenService } from './services/token.service.js';
import { formatError } from './utils/errorFormatting.js';
import { getValidLaunchConfig } from './utils/launchConfigValidation.js';
import {
  authorizeVerifiedLaunch,
  type LtiAuthorizeVerifiedLaunchOptions,
  type LtiLaunchJwksCache,
  type LtiAuthorizedLaunch,
  type LtiLaunchVerificationEventObserver,
  LtiLaunchVerificationError,
  type LtiLaunchVerificationResult,
  type LtiVerifyLaunchEventOptions,
  type LtiVerifyLaunchOptions,
  type LtiVerifiedLaunch,
  notifyLaunchVerificationEvent,
  verifyLtiLaunch,
} from './utils/ltiLaunchVerification.js';
import { buildLtiLoginAuthUrl } from './utils/ltiLogin.js';
import { createNoopLogger } from './utils/noopLogger.js';

/**
 * LTI 1.3 protocol facade for secure login, launch verification, JWKS, and sessions.
 *
 * @example
 * ```typescript
 * const ltiTool = new LTITool({
 *   stateSecret: new TextEncoder().encode('your-secret'),
 *   keyPair: await generateKeyPair('RS256'),
 *   storage: new MemoryStorage()
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
  private logger: LtiLogger;
  private tokenService: TokenService;

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
    options?: LtiVerifyLaunchEventOptions,
  ): Promise<LtiLaunchVerificationResult>;

  async verifyLaunch<TAuthorization>(
    idToken: string,
    state: string,
    options: LtiAuthorizeVerifiedLaunchOptions<TAuthorization>,
  ): Promise<LtiLaunchVerificationResult<LtiAuthorizedLaunch<TAuthorization>>>;

  async verifyLaunch<TAuthorization>(
    idToken: string,
    state: string,
    options?: LtiVerifyLaunchOptions<TAuthorization>,
  ): Promise<LtiLaunchVerificationResult> {
    const onVerificationEvent = this.createVerificationEventObserver(
      options?.onVerificationEvent,
    );

    try {
      const launch = await this.verifyLaunchInternal(idToken, state, onVerificationEvent);

      if (!options?.authorizeVerifiedLaunch) {
        this.notifyLaunchVerified(onVerificationEvent, launch);
        return { success: true, launch };
      }

      const authorizedLaunch = await authorizeVerifiedLaunch(
        launch,
        options.authorizeVerifiedLaunch,
      );
      this.notifyLaunchVerified(onVerificationEvent, authorizedLaunch);
      return {
        success: true,
        launch: authorizedLaunch,
      };
    } catch (error) {
      if (error instanceof LtiLaunchVerificationError) {
        this.notifyLaunchFailed(onVerificationEvent, error);
        return { success: false, error };
      }

      const verificationError = new LtiLaunchVerificationError(
        'unknown_error',
        `Launch verification failed: ${formatError(error)}`,
        error,
      );
      this.notifyLaunchFailed(onVerificationEvent, verificationError);
      return {
        success: false,
        error: verificationError,
      };
    }
  }

  private async verifyLaunchInternal(
    idToken: string,
    state: string,
    onVerificationEvent: LtiLaunchVerificationEventObserver | undefined,
  ): Promise<LtiVerifiedLaunch> {
    return await verifyLtiLaunch({
      idToken,
      state,
      stateSecret: this.config.stateSecret,
      storage: this.config.storage,
      trustedAudiences: this.config.security?.trustedAudiences,
      jwksCache: this.jwksCache,
      remoteJwks: this.config.security?.remoteJwks,
      onVerificationEvent,
    });
  }

  private createVerificationEventObserver(
    requestObserver: LtiLaunchVerificationEventObserver | undefined,
  ): LtiLaunchVerificationEventObserver | undefined {
    const observers = [this.config.onVerificationEvent, requestObserver].filter(
      (observer): observer is LtiLaunchVerificationEventObserver =>
        observer !== undefined,
    );
    if (observers.length === 0) return undefined;

    return (event) => {
      for (const observer of observers) {
        notifyLaunchVerificationEvent(observer, event);
      }
    };
  }

  private notifyLaunchVerified(
    observer: LtiLaunchVerificationEventObserver | undefined,
    launch: LtiVerifiedLaunch,
  ): void {
    notifyLaunchVerificationEvent(observer, {
      type: 'launch_verified',
      issuer: launch.issuer,
      clientId: launch.clientId,
      deploymentId: launch.deploymentId,
    });
  }

  private notifyLaunchFailed(
    observer: LtiLaunchVerificationEventObserver | undefined,
    error: LtiLaunchVerificationError,
  ): void {
    notifyLaunchVerificationEvent(observer, {
      type: 'launch_verification_failed',
      code: error.code,
    });
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
      const subject = launch.payload.sub ?? 'anonymous launch';
      throw new Error(`[Session] Creation failed for ${subject}: ${formatError(error)}`);
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
   * Creates session-bound LTI Advantage services for AGS, NRPS, and Deep Linking.
   *
   * @param session - Active LTI launch session containing advertised service endpoints.
   * @returns Session-bound Advantage service facade.
   */
  createAdvantage(session: LTISession): LtiAdvantage {
    return new LtiAdvantage({
      session,
      tokenService: this.tokenService,
      storage: this.config.storage,
      keyPair: this.config.keyPair,
      keyId: this.config.security?.keyId ?? 'main',
      logger: this.logger,
    });
  }
}
