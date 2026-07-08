import type { DynamicRegistrationAppState } from '../schemas/lti13/dynamicRegistration/dynamicRegistrationAppState.schema.js';
import type { LTIMessage } from '../schemas/lti13/dynamicRegistration/ltiMessages.schema.js';
import type { OpenIDConfiguration } from '../schemas/lti13/dynamicRegistration/openIDConfiguration.schema.js';
import type { ToolRegistrationPayload } from '../schemas/lti13/dynamicRegistration/toolRegistrationPayload.schema.js';
import type {
  LtiLaunchVerificationEventObserver,
  LtiRemoteJwksOptions,
} from '../utils/ltiLaunchVerification.js';

import type { LtiLogger } from './ltiLogger.js';
import type { LTIStorage } from './ltiStorage.js';

export interface PlatformDynamicRegistrationConfig {
  /** Optional resource-link placements to expose during registration */
  resourceLinkPlacements?: string[];
  /** Optional deep-link placements to expose during registration */
  deepLinkPlacements?: string[];
}

export interface CanvasDynamicRegistrationConfig extends PlatformDynamicRegistrationConfig {
  /** Optional Canvas-specific privacy level for launches */
  privacyLevel?: 'public' | 'name_only' | 'email_only' | 'anonymous';
  /** Optional Canvas-specific stable identifier for correlating tool deployments */
  toolId?: string;
  /** Optional Canvas-specific vendor string */
  vendor?: string;
  /** Optional OIDC client URI shown to administrators in Canvas */
  clientUri?: string;
  /** Optional secondary domains included in the Canvas tool configuration */
  secondaryDomains?: string[];
}

export type DynamicRegistrationPlatformConfig =
  | CanvasDynamicRegistrationConfig
  | PlatformDynamicRegistrationConfig;

export interface DynamicRegistrationPlatformsConfig {
  /** Canvas-specific registration settings */
  canvas?: CanvasDynamicRegistrationConfig;
  /** Brightspace-specific placement settings */
  brightspace?: PlatformDynamicRegistrationConfig;
  /** Moodle-specific placement settings */
  moodle?: PlatformDynamicRegistrationConfig;
  /** Sakai-specific placement settings */
  sakai?: PlatformDynamicRegistrationConfig;
}

export type DynamicRegistrationPlatformKey = keyof DynamicRegistrationPlatformsConfig;

export interface DynamicRegistrationCustomizationContext {
  /** Platform OpenID configuration used for this registration attempt */
  openIdConfiguration: OpenIDConfiguration;
  /** LTI Advantage service keys selected by the administrator */
  selectedServices: string[];
  /** Tool Deep Linking endpoint included in the registration payload */
  deepLinkingUri: string;
  /** Tool launch endpoint included in the registration payload */
  launchUri: string;
  /** Tool OIDC login endpoint included in the registration payload */
  loginUri: string;
  /** Tool JWKS endpoint included in the registration payload */
  jwksUri: string;
  /** Display name configured for the tool */
  toolName: string;
  /** JSON-serializable app-owned state from registration initiation */
  appState?: DynamicRegistrationAppState;
  /** Platform-specific registration config resolved for the current platform, when configured */
  platformConfig?: DynamicRegistrationPlatformConfig;
}

/** Dynamic registration configuration for LTI 1.3 tool registration */
export interface DynamicRegistrationConfig {
  /** Base URL of the LTI tool (e.g., 'https://my-tool.com') */
  url: string;
  /** Display name shown to users in the LMS (e.g., 'My Learning Tool') */
  name: string;
  /** Optional description of the tool's functionality */
  description?: string;
  /** Optional URL to tool logo image for LMS display */
  logo?: string;
  /** Additional redirect URIs beyond the default /lti/launch endpoint */
  redirectUris?: string[];
  /** Optional custom deep linking content selection endpoint (defaults to {url}/lti/deep-linking) */
  deepLinkingUri?: string;
  /** Optional custom login endpoint (defaults to {url}/lti/login) */
  loginUri?: string;
  /** Optional custom launch endpoint (defaults to {url}/lti/launch) */
  launchUri?: string;
  /** Optional custom JWKS endpoint (defaults to {url}/lti/jwks) */
  jwksUri?: string;
  /** Optional platform-specific dynamic registration extensions keyed by built-in profile key */
  platforms?: DynamicRegistrationPlatformsConfig;
  /** Final message customization hook applied after platform profile defaults */
  customizeMessages?: (
    context: DynamicRegistrationCustomizationContext,
    messages: LTIMessage[],
  ) => LTIMessage[];
  /** Final payload customization hook applied after platform profile transforms */
  customizePayload?: (
    context: DynamicRegistrationCustomizationContext,
    payload: ToolRegistrationPayload,
  ) => ToolRegistrationPayload;
}

/**
 * Configuration object for initializing an LTI Tool instance.
 * Contains cryptographic keys, secrets, and storage adapter.
 */
export interface LTIConfig {
  /** Secret key used for signing state JWTs during OIDC flow (minimum 32 bytes recommended) */
  stateSecret: Uint8Array;

  /** RSA key pair for signing JWTs and providing JWKS endpoint */
  keyPair: CryptoKeyPair;

  /** Storage adapter for persisting platforms, sessions, and nonces */
  storage: LTIStorage;

  /** Optional structured logger */
  logger?: LtiLogger;

  /**
   * Optional global observer for safe launch verification events.
   *
   * For request-local edge work, prefer the per-call verifyLaunch option so
   * the framework layer can schedule asynchronous writes with waitUntil.
   */
  onVerificationEvent?: LtiLaunchVerificationEventObserver;

  /** Security configuration options */
  security?: {
    /** Key ID for JWKS and JWT signing (defaults to 'main') */
    keyId?: string;
    /** State JWT expiration time in seconds (defaults to 600 = 10 minutes) */
    stateExpirationSeconds?: number;
    /**
     * Additional JWT audience values to trust when a launch ID Token includes
     * audiences besides this tool's client ID. Most tools should leave this unset.
     */
    trustedAudiences?: string[];
    /** Remote JWKS fetch and cache bounds used during launch verification. */
    remoteJwks?: LtiRemoteJwksOptions;
  };

  /** Dynamic registration configuration for LTI 1.3 tool registration */
  dynamicRegistration?: DynamicRegistrationConfig;
}
