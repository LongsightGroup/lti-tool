import type {
  LTIClient,
  LTIDeployment,
  LTIDynamicRegistrationSession,
} from './interfaces/index.js';
import type { LTIStorage } from './interfaces/ltiStorage.js';
import {
  type LtiLaunchRegistrationInput,
  type LtiLaunchRegistrationUpsertResult,
  upsertLaunchRegistration,
} from './launchRegistration.js';
import { AddClientSchema, UpdateClientSchema } from './schemas/client.schema.js';
import { formatError } from './utils/errorFormatting.js';

export class LtiToolAdminServices {
  constructor(private storage: LTIStorage) {}

  async listClients(): Promise<Omit<LTIClient, 'deployments'>[]> {
    try {
      return await this.storage.listClients();
    } catch (error) {
      throw new Error(`[Client] Listing failed: ${formatError(error)}`);
    }
  }

  async updateClient(
    clientId: string,
    client: Partial<Omit<LTIClient, 'id' | 'deployments'>>,
  ): Promise<void> {
    try {
      const validated = UpdateClientSchema.parse(client);
      return await this.storage.updateClient(clientId, validated);
    } catch (error) {
      throw new Error(
        `[Client] Update failed for ID '${clientId}': ${formatError(error)}`,
      );
    }
  }

  async getClientById(clientId: string): Promise<LTIClient | undefined> {
    try {
      return await this.storage.getClientById(clientId);
    } catch (error) {
      throw new Error(
        `[Client] Retrieval failed for ID '${clientId}': ${formatError(error)}`,
      );
    }
  }

  async addClient(client: Omit<LTIClient, 'id' | 'deployments'>): Promise<string> {
    try {
      const validated = AddClientSchema.parse(client);
      return await this.storage.addClient(validated);
    } catch (error) {
      throw new Error(
        `[Client] Creation failed for issuer '${client.iss}': ${formatError(error)}`,
      );
    }
  }

  async upsertLaunchRegistration(
    registration: LtiLaunchRegistrationInput,
  ): Promise<LtiLaunchRegistrationUpsertResult> {
    try {
      return await upsertLaunchRegistration(this.storage, registration);
    } catch (error) {
      throw new Error(
        `[Launch Registration] Upsert failed for issuer '${registration.iss}', client '${registration.clientId}', deployment '${registration.deploymentId}': ${formatError(error)}`,
      );
    }
  }

  async deleteClient(clientId: string): Promise<void> {
    try {
      return await this.storage.deleteClient(clientId);
    } catch (error) {
      throw new Error(
        `[Client] Deletion failed for ID '${clientId}': ${formatError(error)}`,
      );
    }
  }

  async listDeployments(clientId: string): Promise<LTIDeployment[]> {
    try {
      return await this.storage.listDeployments(clientId);
    } catch (error) {
      throw new Error(
        `[Deployment] Listing failed for client '${clientId}': ${formatError(error)}`,
      );
    }
  }

  async getDeploymentByPlatformId(
    clientId: string,
    deploymentId: string,
  ): Promise<LTIDeployment | undefined> {
    try {
      return await this.storage.getDeploymentByPlatformId(clientId, deploymentId);
    } catch (error) {
      throw new Error(
        `[Deployment] Retrieval failed for client '${clientId}', deployment '${deploymentId}': ${formatError(error)}`,
      );
    }
  }

  async addDeployment(
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ): Promise<string> {
    try {
      return await this.storage.addDeployment(clientId, deployment);
    } catch (error) {
      throw new Error(
        `[Deployment] Creation failed for client '${clientId}': ${formatError(error)}`,
      );
    }
  }

  async updateDeploymentById(
    clientId: string,
    deploymentId: string,
    deployment: Partial<LTIDeployment>,
  ): Promise<void> {
    try {
      return await this.storage.updateDeploymentById(clientId, deploymentId, deployment);
    } catch (error) {
      throw new Error(
        `Deployment update failed for client '${clientId}' and deployment '${deploymentId}': ${formatError(error)}`,
      );
    }
  }

  async deleteDeploymentById(clientId: string, deploymentId: string): Promise<void> {
    try {
      return await this.storage.deleteDeploymentById(clientId, deploymentId);
    } catch (error) {
      throw new Error(
        `[Deployment] Deletion failed for client '${clientId}', deployment '${deploymentId}': ${formatError(error)}`,
      );
    }
  }

  async setRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    try {
      return await this.storage.setRegistrationSession(sessionId, session);
    } catch (error) {
      throw new Error(
        `[Dynamic Registration] Session storage failed for ID '${sessionId}': ${formatError(error)}`,
      );
    }
  }

  async getRegistrationSession(
    sessionId: string,
  ): Promise<LTIDynamicRegistrationSession | undefined> {
    try {
      return await this.storage.getRegistrationSession(sessionId);
    } catch (error) {
      throw new Error(
        `[Dynamic Registration] Session retrieval failed for ID '${sessionId}': ${formatError(error)}`,
      );
    }
  }

  async deleteRegistrationSession(sessionId: string): Promise<void> {
    try {
      return await this.storage.deleteRegistrationSession(sessionId);
    } catch (error) {
      throw new Error(
        `[Dynamic Registration] Session deletion failed for ID '${sessionId}': ${formatError(error)}`,
      );
    }
  }
}
