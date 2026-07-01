import {
  createNoopLogger,
  type LTIClient,
  type LTIDeployment,
  type LTIDynamicRegistrationSession,
  type LTILaunchConfig,
  type LTISession,
  type LTIStorage,
} from '@longsightgroup/lti-tool';
import type { Logger } from 'pino';

import type { MemoryStorageConfig } from './interfaces/memoryStorageConfig.js';

/**
 * In-memory LTI storage implementation.
 *
 * ⚠️  **WARNING: NOT SUITABLE FOR SERVERLESS/MULTI-INSTANCE DEPLOYMENTS**
 *
 * This storage keeps all data in memory and provides no persistence.
 * It's intended for:
 * - Development and testing
 * - Single-instance server deployments
 * - Reference implementation
 *
 * DO NOT use in serverless environments (AWS Lambda, Vercel, etc.) as:
 * - Each instance has isolated memory
 * - Nonce validation becomes unreliable across instances
 * - Security vulnerabilities may arise from replay attacks
 *
 * For production serverless deployments, use DynamoDbStorage or similar.
 */
export class MemoryStorage implements LTIStorage {
  // simple storage maps
  private clients = new Map<string, LTIClient>();
  private deployments = new Map<string, LTIDeployment>();

  // lookup indexes (for lti launch)
  private clientLookup = new Map<string, string>(); // issuer#clientId -> internalClientId

  private sessions = new Map<string, LTISession>();
  private usedNonces = new Set<string>();
  private registrationSessions = new Map<string, LTIDynamicRegistrationSession>();
  private logger: Logger;

  constructor(config?: MemoryStorageConfig) {
    this.logger = config?.logger ?? createNoopLogger();
  }

  // oxlint-disable-next-line require-await
  async listClients(): Promise<Omit<LTIClient, 'deployments'>[]> {
    return [...this.clients.values()].map(({ deployments: _deployments, ...client }) => {
      return client;
    });
  }

  // oxlint-disable-next-line require-await
  async getClientById(clientId: string): Promise<LTIClient | undefined> {
    return this.clients.get(clientId);
  }

  // oxlint-disable-next-line require-await
  async addClient(client: Omit<LTIClient, 'id' | 'deployments'>): Promise<string> {
    const clientId = crypto.randomUUID();
    const clientWithId = { ...client, id: clientId, deployments: [] };

    // store in primary map
    this.logger.info({ clientWithId }, 'adding client');
    this.clients.set(clientId, clientWithId);

    // store in lookup map
    this.clientLookup.set(`${client.iss}#${client.clientId}`, clientId);

    this.logger.debug({ clientCount: this.clients.size }, 'client list count updated');

    return clientId;
  }

  // oxlint-disable-next-line no-unused-vars require-await
  async updateClient(
    clientId: string,
    client: Partial<Omit<LTIClient, 'id' | 'deployments'>>,
  ): Promise<void> {
    const existing = this.clients.get(clientId);
    if (!existing) {
      throw new Error('Client not found');
    }

    this.clientLookup.delete(`${existing.iss}#${existing.clientId}`);

    const updated = { ...existing, ...client, id: existing.id };
    this.clients.set(clientId, updated);
    this.clientLookup.set(`${updated.iss}#${updated.clientId}`, clientId);

    if (client.iss !== undefined || client.clientId !== undefined) {
      this.reindexDeployments(updated, existing.iss, existing.clientId);
    }
  }

  private reindexDeployments(
    client: LTIClient,
    previousIss: string,
    previousClientId: string,
  ): void {
    for (const deployment of client.deployments) {
      this.deployments.delete(
        `${previousIss}#${previousClientId}#${deployment.deploymentId}`,
      );
      this.deployments.set(
        `${client.iss}#${client.clientId}#${deployment.deploymentId}`,
        deployment,
      );
    }
  }

  // oxlint-disable-next-line require-await
  async deleteClient(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (client) {
      // Clean up deployments
      for (const deployment of client.deployments) {
        const compositeKey = `${client.iss}#${client.clientId}#${deployment.deploymentId}`;
        this.deployments.delete(compositeKey);
      }
      // Clean up lookup
      this.clientLookup.delete(`${client.iss}#${client.clientId}`);
    }
    this.clients.delete(clientId);
  }

  // oxlint-disable-next-line require-await
  async listDeployments(clientId: string): Promise<LTIDeployment[]> {
    const client = this.clients.get(clientId);
    if (!client) {
      return [];
    }
    return client.deployments;
  }

  // oxlint-disable-next-line require-await
  async getDeploymentByPlatformId(
    clientId: string,
    deploymentId: string,
  ): Promise<LTIDeployment | undefined> {
    const client = this.clients.get(clientId);
    if (!client) return undefined;

    const compositeKey = `${client.iss}#${client.clientId}#${deploymentId}`;
    return this.deployments.get(compositeKey);
  }

  // oxlint-disable-next-line require-await
  async addDeployment(
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ): Promise<string> {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Client not found: ${clientId}`);
    }
    const internalDeploymentId = crypto.randomUUID();
    const deploymentWithId = { ...deployment, id: internalDeploymentId };
    client.deployments.push(deploymentWithId);

    // use a composite key so we don't have collisions
    const compositeKey = `${client.iss}#${client.clientId}#${deployment.deploymentId}`;
    this.deployments.set(compositeKey, deploymentWithId);

    return internalDeploymentId;
  }

  // oxlint-disable-next-line require-await
  async updateDeploymentById(
    clientId: string,
    deploymentId: string,
    deployment: Partial<LTIDeployment>,
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`Client not found: ${clientId}`);
    }

    const existing = client.deployments.find(
      (candidate) => candidate.id === deploymentId,
    );
    if (!existing) {
      throw new Error('Deployment not found');
    }

    const updated = { ...existing, ...deployment, id: existing.id };
    const oldCompositeKey = `${client.iss}#${client.clientId}#${existing.deploymentId}`;
    const newCompositeKey = `${client.iss}#${client.clientId}#${updated.deploymentId}`;
    const index = client.deployments.findIndex(
      (candidate) => candidate.id === deploymentId,
    );
    client.deployments[index] = updated;
    this.deployments.delete(oldCompositeKey);
    this.deployments.set(newCompositeKey, updated);
  }

  // oxlint-disable-next-line require-await
  async deleteDeploymentById(clientId: string, deploymentId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const existing = client.deployments.find(
      (candidate) => candidate.id === deploymentId,
    );
    if (!existing) return;

    client.deployments = client.deployments.filter(
      (candidate) => candidate.id !== deploymentId,
    );
    this.deployments.delete(`${client.iss}#${client.clientId}#${existing.deploymentId}`);
  }

  // oxlint-disable-next-line require-await
  async validateNonce(nonce: string): Promise<boolean> {
    if (this.usedNonces.has(nonce)) {
      this.logger.warn({ nonce }, 'nonce already used - replay attack detected');
      return false;
    }

    this.usedNonces.add(nonce);
    this.logger.debug({ nonce }, 'nonce validated and consumed');
    return true;
  }

  // oxlint-disable-next-line require-await
  async getSession(sessionId: string): Promise<LTISession | undefined> {
    this.logger.debug({ sessionId }, 'getting session');
    const session = this.sessions.get(sessionId);

    if (!session) {
      this.logger.warn({ sessionId }, 'session not found');
    }

    return session;
  }

  // oxlint-disable-next-line require-await
  async addSession(session: LTISession): Promise<string> {
    this.logger.debug({ sessionId: session.id }, 'adding session');
    this.sessions.set(session.id, session);
    this.logger.debug({ sessionCount: this.sessions.size }, 'session count');
    return session.id;
  }

  // oxlint-disable-next-line require-await no-unused-vars
  async getLaunchConfig(
    iss: string,
    clientId: string,
    deploymentId: string,
  ): Promise<LTILaunchConfig | undefined> {
    this.logger.debug({ iss, clientId, deploymentId }, 'getting launch config');

    const clientInternalId = this.clientLookup.get(`${iss}#${clientId}`);

    if (!clientInternalId) {
      this.logger.warn({ clientInternalId }, 'client not found in lookup');
      return undefined;
    }

    const client = this.clients.get(clientInternalId);
    if (!client) {
      this.logger.warn({ clientInternalId }, 'client not found');
      return undefined;
    }

    const deployment = await this.getDeploymentByPlatformId(
      clientInternalId,
      deploymentId,
    );
    if (!deployment) {
      this.logger.warn({ deploymentId }, 'deployment not found');
      return undefined;
    }

    return {
      iss: client.iss,
      clientId: client.clientId,
      deploymentId: deployment.deploymentId,
      authUrl: client.authUrl,
      jwksUrl: client.jwksUrl,
      tokenUrl: client.tokenUrl,
    };
  }

  // oxlint-disable-next-line require-await no-unused-vars
  async saveLaunchConfig(launchConfig: LTILaunchConfig): Promise<void> {
    // Memory storage doesn't need to persist launch configs separately
    // since they're derived from client data
    this.logger.debug({ launchConfig }, 'launch config would be saved (no-op in memory)');
  }

  // oxlint-disable-next-line require-await
  async setRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    this.registrationSessions.set(sessionId, session);
    this.logger.debug({ sessionId, session }, 'registration session stored');
  }

  // oxlint-disable-next-line require-await
  async getRegistrationSession(
    sessionId: string,
  ): Promise<LTIDynamicRegistrationSession | undefined> {
    const session = this.registrationSessions.get(sessionId);

    if (!session) {
      this.logger.warn({ sessionId }, 'registration session not found');
      return undefined;
    }

    // check expiration
    if (session.expiresAt < Date.now()) {
      this.logger.warn({ sessionId }, 'registration session expired');
      this.registrationSessions.delete(sessionId);
      return undefined;
    }

    return session;
  }

  // oxlint-disable-next-line require-await
  async deleteRegistrationSession(sessionId: string): Promise<void> {
    this.registrationSessions.delete(sessionId);
  }
}
