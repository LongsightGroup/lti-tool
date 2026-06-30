import { generateKeyPair } from 'jose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  LTIClient,
  LTIDeployment,
  LTIDynamicRegistrationSession,
  LTILaunchConfig,
  LTISession,
  LTIStorage,
} from '../src/interfaces/index.js';
import { LTITool } from '../src/ltiTool.js';

class RecordingStorage implements LTIStorage {
  readonly launchConfigs: LTILaunchConfig[] = [];
  private readonly clients = new Map<string, LTIClient>();

  listClients(): Promise<Omit<LTIClient, 'deployments'>[]> {
    return Promise.resolve(
      [...this.clients.values()].map(
        ({ deployments: _deployments, ...client }) => client,
      ),
    );
  }

  getClientById(clientId: string): Promise<LTIClient | undefined> {
    return Promise.resolve(this.clients.get(clientId));
  }

  addClient(client: Omit<LTIClient, 'id' | 'deployments'>): Promise<string> {
    const clientId = `client-${this.clients.size + 1}`;
    this.clients.set(clientId, { id: clientId, ...client, deployments: [] });
    return Promise.resolve(clientId);
  }

  updateClient(
    clientId: string,
    client: Partial<Omit<LTIClient, 'id' | 'deployments'>>,
  ): Promise<void> {
    const existing = this.clients.get(clientId);
    if (existing === undefined) throw new Error('Client not found');
    this.clients.set(clientId, { ...existing, ...client });
    return Promise.resolve();
  }

  deleteClient(clientId: string): Promise<void> {
    this.clients.delete(clientId);
    return Promise.resolve();
  }

  listDeployments(clientId: string): Promise<LTIDeployment[]> {
    return Promise.resolve(this.clients.get(clientId)?.deployments ?? []);
  }

  getDeploymentByPlatformId(
    clientId: string,
    deploymentId: string,
  ): Promise<LTIDeployment | undefined> {
    return Promise.resolve(
      this.clients
        .get(clientId)
        ?.deployments.find((deployment) => deployment.deploymentId === deploymentId),
    );
  }

  addDeployment(
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ): Promise<string> {
    const existing = this.clients.get(clientId);
    if (existing === undefined) throw new Error('Client not found');

    const deploymentId = `deployment-${existing.deployments.length + 1}`;
    const storedDeployment = { id: deploymentId, ...deployment };
    existing.deployments.push(storedDeployment);
    return Promise.resolve(deploymentId);
  }

  updateDeploymentById(
    clientId: string,
    deploymentId: string,
    deployment: Partial<LTIDeployment>,
  ): Promise<void> {
    const client = this.clients.get(clientId);
    const existing = client?.deployments.find(
      (candidate) => candidate.id === deploymentId,
    );
    if (client === undefined || existing === undefined) {
      throw new Error('Deployment not found');
    }

    const index = client.deployments.indexOf(existing);
    client.deployments[index] = { ...existing, ...deployment, id: existing.id };
    return Promise.resolve();
  }

  deleteDeploymentById(clientId: string, deploymentId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (client === undefined) return Promise.resolve();

    client.deployments = client.deployments.filter(
      (deployment) => deployment.id !== deploymentId,
    );
    return Promise.resolve();
  }

  getSession(_sessionId: string): Promise<LTISession | undefined> {
    return Promise.resolve(undefined);
  }

  addSession(session: LTISession): Promise<string> {
    return Promise.resolve(session.id);
  }

  validateNonce(_nonce: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  getLaunchConfig(
    iss: string,
    clientId: string,
    deploymentId: string,
  ): Promise<LTILaunchConfig | undefined> {
    return Promise.resolve(
      this.launchConfigs.find(
        (config) =>
          config.iss === iss &&
          config.clientId === clientId &&
          config.deploymentId === deploymentId,
      ),
    );
  }

  saveLaunchConfig(launchConfig: LTILaunchConfig): Promise<void> {
    this.launchConfigs.push(launchConfig);
    return Promise.resolve();
  }

  setRegistrationSession(
    _sessionId: string,
    _session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    return Promise.resolve();
  }

  getRegistrationSession(
    _sessionId: string,
  ): Promise<LTIDynamicRegistrationSession | undefined> {
    return Promise.resolve(undefined);
  }

  deleteRegistrationSession(_sessionId: string): Promise<void> {
    return Promise.resolve();
  }
}

describe('LTITool launch registration upsert', () => {
  let keyPair: CryptoKeyPair;
  let storage: RecordingStorage;
  let ltiTool: LTITool;

  beforeAll(async () => {
    keyPair = await generateKeyPair('RS256');
  });

  beforeEach(() => {
    storage = new RecordingStorage();
    ltiTool = new LTITool({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage,
    });
  });

  it('creates client, deployment, and launch config from platform identifiers', async () => {
    const input = {
      iss: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      deploymentId: 'platform-deployment-id',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/jwks',
    };

    const result = await ltiTool.upsertLaunchRegistration(input);

    await expect(storage.listClients()).resolves.toEqual([
      {
        id: result.client.id,
        name: input.iss,
        iss: input.iss,
        clientId: input.clientId,
        authUrl: input.authUrl,
        tokenUrl: input.tokenUrl,
        jwksUrl: input.jwksUrl,
      },
    ]);
    await expect(storage.listDeployments(result.client.id)).resolves.toEqual([
      {
        id: result.deployment.id,
        deploymentId: input.deploymentId,
      },
    ]);
    await expect(
      storage.getLaunchConfig(input.iss, input.clientId, input.deploymentId),
    ).resolves.toEqual(input);
    expect(result).toMatchObject({
      createdClient: true,
      createdDeployment: true,
      client: {
        id: 'client-1',
        clientId: input.clientId,
      },
      deployment: {
        id: 'deployment-1',
        deploymentId: input.deploymentId,
      },
    });
  });

  it('updates existing client endpoints and matches deployment by platform ID', async () => {
    const first = await ltiTool.upsertLaunchRegistration({
      iss: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      deploymentId: 'platform-deployment-id',
      authUrl: 'https://platform.example.com/old-auth',
      tokenUrl: 'https://platform.example.com/old-token',
      jwksUrl: 'https://platform.example.com/old-jwks',
      name: 'Existing Platform',
      deploymentName: 'Existing Deployment',
    });

    const result = await ltiTool.upsertLaunchRegistration({
      iss: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      deploymentId: 'platform-deployment-id',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/jwks',
    });

    await expect(storage.getClientById(first.client.id)).resolves.toMatchObject({
      id: first.client.id,
      name: 'Existing Platform',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/jwks',
    });
    await expect(storage.listDeployments(first.client.id)).resolves.toEqual([
      {
        id: first.deployment.id,
        deploymentId: 'platform-deployment-id',
        name: 'Existing Deployment',
      },
    ]);
    expect(storage.launchConfigs).toContainEqual({
      iss: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      deploymentId: 'platform-deployment-id',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/jwks',
    });
    expect(result).toMatchObject({
      createdClient: false,
      createdDeployment: false,
      client: {
        id: first.client.id,
        name: 'Existing Platform',
      },
      deployment: {
        id: first.deployment.id,
        deploymentId: 'platform-deployment-id',
      },
    });
  });
});
