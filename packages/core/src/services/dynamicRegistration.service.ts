import { LTI_CLAIM_TOOL_CONFIGURATION } from '../constants.js';
import { LtiServiceError } from '../errors/ltiServiceError.js';
import type { LTIClient } from '../interfaces/ltiClient.js';
import type { DynamicRegistrationConfig } from '../interfaces/ltiConfig.js';
import type { LTIDeployment } from '../interfaces/ltiDeployment.js';
import type { LTIDynamicRegistrationSession } from '../interfaces/ltiDynamicRegistrationSession.js';
import type { LTILaunchConfig } from '../interfaces/ltiLaunchConfig.js';
import type { LtiLogger } from '../interfaces/ltiLogger.js';
import type { LTIStorage } from '../interfaces/ltiStorage.js';
import {
  projectDynamicRegistrationLaunchRegistration,
  upsertLaunchRegistration,
} from '../launchRegistration.js';
import {
  DynamicRegistrationAppStateSchema,
  type DynamicRegistrationAppState,
} from '../schemas/lti13/dynamicRegistration/dynamicRegistrationAppState.schema.js';
import type { DynamicRegistrationForm } from '../schemas/lti13/dynamicRegistration/ltiDynamicRegistration.schema.js';
import {
  type OpenIDConfiguration,
  openIDConfigurationSchema,
} from '../schemas/lti13/dynamicRegistration/openIDConfiguration.schema.js';
import type { RegistrationRequest } from '../schemas/lti13/dynamicRegistration/registrationRequest.schema.js';
import type { RegistrationResponse } from '../schemas/lti13/dynamicRegistration/registrationResponse.schema.js';
import { escapeHtml } from '../utils/htmlEscaping.js';

import {
  postRegistrationToPlatform,
  renderDynamicRegistrationForm,
} from './dynamicRegistrationHandlers/platform.js';
import { fetchOpenIdConfiguration } from './dynamicRegistrationOpenIdFetch.js';
import { buildToolRegistrationPayload } from './dynamicRegistrationPayload.js';

export interface LtiDynamicRegistrationCompletionResult {
  html: string;
  client: LTIClient;
  deployment: LTIDeployment;
  launchConfig: LTILaunchConfig;
  createdClient: boolean;
  createdDeployment: boolean;
  appState?: DynamicRegistrationAppState;
}

export interface LtiDynamicRegistrationInitiationResult {
  readonly html: string;
  readonly sessionToken: string;
}

export interface LtiDynamicRegistrationInitiationOptions {
  /** JSON-serializable app-owned state returned with the completion result */
  appState?: DynamicRegistrationAppState;
}

const storeDynamicRegistrationResult = (input: {
  storage: LTIStorage;
  session: LTIDynamicRegistrationSession;
  registrationResponse: RegistrationResponse;
}): Promise<Omit<LtiDynamicRegistrationCompletionResult, 'html' | 'appState'>> =>
  upsertLaunchRegistration(
    input.storage,
    projectDynamicRegistrationLaunchRegistration({
      session: input.session,
      registrationResponse: input.registrationResponse,
    }),
  );

/**
 * Service for handling LTI 1.3 dynamic registration workflows.
 *
 * Provides a complete implementation of the LTI 1.3 Dynamic Registration specification,
 * enabling tools to automatically register with LTI platforms without manual configuration.
 * Handles the full registration lifecycle from initiation to completion with security validation.
 *
 * ## Key Features
 * - **Platform Discovery**: Fetches and validates OpenID Connect configuration from LTI platforms
 * - **Security Validation**: Enforces hostname matching and session-based CSRF protection
 * - **Platform Profiles**: Uses a generic registration flow with targeted platform-specific message overrides only where needed
 * - **Service Selection**: Allows administrators to choose which LTI Advantage services to enable (AGS, NRPS, Deep Linking)
 * - **Automatic Storage**: Persists client and deployment configurations for future launches
 *
 * ## Registration Flow
 * 1. **Initiation**: Platform redirects to tool with registration request
 * 2. **Discovery**: Tool fetches platform's OpenID Connect configuration
 * 3. **Form Generation**: Tool presents service selection form to administrator
 * 4. **Registration**: Tool submits registration payload to platform
 * 5. **Storage**: Tool stores received client credentials and deployment information
 *
 * ## Security Features
 * - Session-based registration with 15-minute expiration
 * - CSRF protection via secure session tokens
 * - Hostname validation between OIDC endpoint and issuer
 * - One-time session consumption to prevent replay attacks
 *
 * @example
 * ```typescript
 * const service = new DynamicRegistrationService(
 *   storage,
 *   dynamicRegistrationConfig,
 *   logger
 * );
 *
 * // Initiate registration
 * const initiation = await service.initiateDynamicRegistration(request, '/lti/register');
 * const formHtml = initiation.html;
 * const sessionToken = initiation.sessionToken;
 *
 * // Complete registration
 * const result = await service.completeDynamicRegistration(formData);
 * const successHtml = result.html;
 * ```
 *
 * @see https://www.imsglobal.org/spec/lti-dr/v1p0 LTI 1.3 Dynamic Registration specification
 */
export class DynamicRegistrationService {
  /**
   * Creates a new DynamicRegistrationService instance.
   *
   * @param storage - Storage adapter for persisting client and deployment configurations
   * @param dynamicRegistrationConfig - Tool configuration including URLs and service settings
   * @param logger - Structured logger for debug and error logging
   */
  constructor(
    private storage: LTIStorage,
    private dynamicRegistrationConfig: DynamicRegistrationConfig,
    private logger: LtiLogger,
  ) {}

  /**
   * Fetches and validates the OpenID Connect configuration from an LTI platform during dynamic registration.
   * Validates that the OIDC endpoint and issuer have matching hostnames for security.
   *
   * @param registrationRequest - Registration request containing openid_configuration URL and optional registration_token
   * @returns Validated OpenID configuration with platform endpoints and supported features
   * @throws {LtiServiceError} When the configuration fetch fails, validation fails, or hostname mismatch detected
   */
  async fetchPlatformConfiguration(
    registrationRequest: RegistrationRequest,
  ): Promise<OpenIDConfiguration> {
    const { openid_configuration, registration_token } = registrationRequest;
    const { data, finalHostname } = await fetchOpenIdConfiguration({
      openidConfiguration: openid_configuration,
      registrationToken: registration_token,
    });

    let openIdConfiguration: OpenIDConfiguration;
    try {
      openIdConfiguration = openIDConfigurationSchema.parse(data);
    } catch (error) {
      throw new LtiServiceError({
        code: 'platform_response_invalid',
        serviceKind: 'dynamic_registration',
        operation: 'fetchPlatformConfiguration',
        message: 'Dynamic registration OpenID configuration response failed validation',
        cause: error,
      });
    }
    this.logger.debug({ openIdConfiguration });

    const issuerEndpoint = new URL(openIdConfiguration.issuer);
    if (finalHostname !== issuerEndpoint.hostname) {
      const message = 'OpenID configuration issuer does not match the discovery endpoint';
      this.logger.error(
        {
          endpointHostname: finalHostname,
          issuerHostname: issuerEndpoint.hostname,
        },
        message,
      );
      throw new LtiServiceError({
        code: 'platform_response_invalid',
        serviceKind: 'dynamic_registration',
        operation: 'fetchPlatformConfiguration',
        message,
      });
    }

    return openIdConfiguration;
  }

  /**
   * Initiates LTI 1.3 dynamic registration by fetching platform configuration and generating a registration form.
   * Creates a temporary session and returns the rendered service-selection form plus its session token.
   *
   * @param registrationRequest - Registration request containing openid_configuration URL and optional registration_token
   * @param requestPath - Current request path used to build form action URLs
   * @returns Initiation result with HTML form and registration session token
   * @throws {Error} When platform configuration fetch fails or session creation fails
   */
  async initiateDynamicRegistration(
    registrationRequest: RegistrationRequest,
    requestPath: string,
    options: LtiDynamicRegistrationInitiationOptions = {},
  ): Promise<LtiDynamicRegistrationInitiationResult> {
    // 1. Validate request
    const openIdConfiguration =
      await this.fetchPlatformConfiguration(registrationRequest);

    // 2. generate and store session
    const sessionToken = crypto.randomUUID();
    const appState = DynamicRegistrationAppStateSchema.optional().parse(options.appState);
    const session: LTIDynamicRegistrationSession = {
      openIdConfiguration,
      ...(registrationRequest.registration_token === undefined
        ? {}
        : { registrationToken: registrationRequest.registration_token }),
      ...(appState === undefined ? {} : { appState }),
      expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
    };

    await this.storage.setRegistrationSession(sessionToken, session);

    // 3. build registration form
    return {
      html: renderDynamicRegistrationForm(openIdConfiguration, requestPath, sessionToken),
      sessionToken,
    };
  }

  /**
   * Completes LTI 1.3 dynamic registration by processing form submission and storing client configuration.
   * Validates session, registers with platform, stores client/deployment data, and returns success page.
   *
   * @param dynamicRegistrationForm - Validated form data containing selected services and session token
   * @returns HTML success page plus stored client, deployment, and launch config
   * @throws {Error} When session is invalid, registration fails, or storage operations fail
   */
  async completeDynamicRegistration(
    dynamicRegistrationForm: DynamicRegistrationForm,
  ): Promise<LtiDynamicRegistrationCompletionResult> {
    // 1. Verify session token
    const session = await this.verifyRegistrationSession(
      dynamicRegistrationForm.sessionToken,
    );
    if (!session) {
      throw new LtiServiceError({
        code: 'registration_session_expired',
        serviceKind: 'dynamic_registration',
        operation: 'completeDynamicRegistration',
        message: 'Dynamic registration session is invalid or expired',
      });
    }

    // 2. build payload
    const toolRegistrationPayload = buildToolRegistrationPayload({
      config: this.dynamicRegistrationConfig,
      openIdConfiguration: session.openIdConfiguration,
      selectedServices: dynamicRegistrationForm.services ?? [],
      appState: session.appState,
    });

    // 3. Post registration request to the platform
    const registrationResponse = await postRegistrationToPlatform(
      session.openIdConfiguration.registration_endpoint,
      toolRegistrationPayload,
      this.logger,
      session.registrationToken,
    );

    // 4. save to storage
    const storedRegistration = await storeDynamicRegistrationResult({
      storage: this.storage,
      session,
      registrationResponse,
    });

    // 5. return success
    const successHtml = this.getRegistrationSuccessHtml(registrationResponse);
    return {
      html: successHtml,
      ...storedRegistration,
      ...(session.appState === undefined ? {} : { appState: session.appState }),
    };
  }

  /**
   * Verifies and consumes a registration session token for security validation.
   * Retrieves the session data and immediately deletes it to prevent replay attacks.
   *
   * @param sessionToken - UUID session token from the registration form
   * @returns Session data if valid and not expired, undefined otherwise
   */
  async verifyRegistrationSession(
    sessionToken: string,
  ): Promise<LTIDynamicRegistrationSession | undefined> {
    const session = await this.storage.getRegistrationSession(sessionToken);
    if (session) {
      await this.storage.deleteRegistrationSession(sessionToken);
    }
    return session;
  }

  private getRegistrationSuccessHtml(registrationResponse: RegistrationResponse): string {
    return `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Registration Complete</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB" crossorigin="anonymous">
    </head>
    <body class="container mt-4">
      <div class="alert alert-success" role="alert">
        <h4 class="alert-heading">Registration Successful!</h4>
        <p>Your LTI tool has been successfully registered with the platform.</p>
        <hr>
        <p class="mb-0">You can now close this window and return to your LMS.</p>
      </div>
      
      <div class="card">
        <div class="card-header">
          <h5 class="card-title mb-0">Registration Details</h5>
        </div>
        <div class="card-body">
          <dl class="row">
            <dt class="col-sm-3">Tool Name:</dt>
            <dd class="col-sm-9">${escapeHtml(registrationResponse.client_name)}</dd>
            <dt class="col-sm-3">Client ID:</dt>
            <dd class="col-sm-9"><code>${escapeHtml(registrationResponse.client_id)}</code></dd>
            <dt class="col-sm-3">Deployment ID:</dt>
            <dd class="col-sm-9"><code>${escapeHtml(registrationResponse[LTI_CLAIM_TOOL_CONFIGURATION].deployment_id || 'default')}</code></dd>
          </dl>
        </div>
      </div>
      
      <div class="mt-4 text-center">
        <button type="button" class="btn btn-primary btn-lg" onclick="closeWindow()">
          Close Window
        </button>
      </div>
      
      <script>
        function closeWindow() {
          (window.opener || window.parent).postMessage({subject:'org.imsglobal.lti.close'}, '*');
        }
      </script>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js" integrity="sha384-FKyoEForCGlyvwx9Hj09JcYn3nv7wiPVlz7YYwJrWVcXK/BmnVDxM+D2scQbITxI" crossorigin="anonymous"></script>
    </body>
  </html>`;
  }
}
