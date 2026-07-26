import type { LTIClient } from './ltiClient.js';
import type { LTIDeployment } from './ltiDeployment.js';
import type { LTIDynamicRegistrationSession } from './ltiDynamicRegistrationSession.js';
import type { LTILaunchConfig } from './ltiLaunchConfig.js';
import type { LTISession } from './ltiSession.js';

/**
 * Storage interface for persisting LTI Client configurations, user sessions, and security nonces.
 * Implement this interface to use different storage backends (memory, database, Redis, etc.).
 */
export interface LTIStorage {
  // Client management

  /**
   * Retrieves all clients configured in the system.
   *
   * @returns Array of all client configurations
   */
  listClients(): Promise<Omit<LTIClient, 'deployments'>[]>;

  /**
   * Retrieves client configuration by its unique id.
   *
   * @param clientId - Unique client identifier
   * @returns Client configuration if found, undefined otherwise
   */
  getClientById(clientId: string): Promise<LTIClient | undefined>;

  /**
   * Adds a new client configuration to storage.
   *
   * @param client - Partial client configuration object
   */
  addClient(client: Omit<LTIClient, 'id' | 'deployments'>): Promise<string>;

  /**
   * Updates an existing client configuration.
   *
   * @param clientId - Unique client identifier
   * @param client - Partial client object with fields to update
   */
  updateClient(
    clientId: string,
    client: Partial<Omit<LTIClient, 'id' | 'deployments'>>,
  ): Promise<void>;

  /**
   * Removes a client configuration from storage.
   *
   * @param clientId - Unique client identifier
   */
  deleteClient(clientId: string): Promise<void>;

  // Deployment management

  /**
   * Lists all deployments for a specific client.
   *
   * @param clientId - Client identifier
   * @returns Array of deployment configurations
   */
  listDeployments(clientId: string): Promise<LTIDeployment[]>;

  /**
   * Retrieves deployment configuration by client ID and LMS-provided deployment ID.
   *
   * @param clientId - Unique client identifier
   * @param deploymentId - LMS-provided deployment identifier used in launch requests
   * @returns Deployment configuration if found, undefined otherwise
   */
  getDeploymentByPlatformId(
    clientId: string,
    deploymentId: string,
  ): Promise<LTIDeployment | undefined>;

  /**
   * Adds a new deployment to an existing client.
   *
   * @param clientId - Client identifier
   * @param deployment - Deployment configuration to add
   */
  addDeployment(clientId: string, deployment: Omit<LTIDeployment, 'id'>): Promise<string>;

  /**
   * Updates an existing deployment configuration.
   * @param clientId - Client identifier
   * @param deploymentId - Internal deployment identifier to update
   * @param deployment - Partial deployment object with fields to update
   */
  updateDeploymentById(
    clientId: string,
    deploymentId: string,
    deployment: Partial<LTIDeployment>,
  ): Promise<void>;

  /**
   * Removes a deployment from a Client.
   *
   * @param clientId - Client identifier
   * @param deploymentId - Internal deployment identifier to remove
   */
  deleteDeploymentById(clientId: string, deploymentId: string): Promise<void>;

  // Session management

  /**
   * Retrieves an active user session by session ID.
   *
   * @param sessionId - Unique session identifier (typically a UUID)
   * @returns Session object if found and valid, undefined otherwise
   */
  getSession(sessionId: string): Promise<LTISession | undefined>;

  /**
   * Stores a new user session after successful LTI launch.
   *
   * @param session - Complete session object with user, context, and service data
   * @returns The session ID for reference
   */
  addSession(session: LTISession): Promise<string>;

  // Nonce validation (prevent replay attacks)

  /**
   * Atomically claims a launch nonce during verification to prevent replay attacks.
   *
   * Storage adapters own nonce TTL policy. The method returns true only when this
   * verification is the first successful claim for the nonce and the adapter can store
   * the claim until its configured expiration.
   *
   * @param nonce - Nonce value from the verified launch state and ID token
   * @returns true if the nonce was claimed for the first time, false if already claimed or expired
   */
  validateNonce(nonce: string): Promise<boolean>;

  // Launch configuration management

  /**
   * Retrieves launch configuration for LTI authentication flow.
   *
   * @param iss - Platform issuer URL (identifies the LMS)
   * @param clientId - OAuth2 client identifier for this tool
   * @param deploymentId - Deployment identifier within the platform
   * @returns Launch configuration if found, undefined otherwise
   */
  getLaunchConfig(
    iss: string,
    clientId: string,
    deploymentId: string,
  ): Promise<LTILaunchConfig | undefined>;

  /**
   * Stores launch configuration for platform authentication.
   *
   * @param launchConfig - Complete launch configuration with auth URLs and keys
   */
  saveLaunchConfig(launchConfig: LTILaunchConfig): Promise<void>;

  // Dynamic Registration

  /**
   * Stores a temporary registration session during LTI 1.3 dynamic registration flow.
   * Sessions have a TTL and are automatically cleaned up when expired.
   *
   * @param sessionId - Unique session identifier (typically a UUID)
   * @param session - Registration session data including platform config and tokens
   */
  setRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void>;

  /**
   * Atomically removes and returns a registration session for one-time completion.
   *
   * Concurrent calls for the same session ID must return the session to at most one caller.
   *
   * @param sessionId - Unique session identifier
   * @returns Registration session if found and not expired, undefined otherwise
   */
  consumeRegistrationSession(
    sessionId: string,
  ): Promise<LTIDynamicRegistrationSession | undefined>;
}
