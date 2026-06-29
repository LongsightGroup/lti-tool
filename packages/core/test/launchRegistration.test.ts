import { generateKeyPair } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LTIStorage } from '../src/interfaces/index.js';
import { LTITool } from '../src/ltiTool.js';

const createMockStorage = (): LTIStorage => ({
  listClients: vi.fn(),
  getClientById: vi.fn(),
  addClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
  listDeployments: vi.fn(),
  getDeployment: vi.fn(),
  addDeployment: vi.fn(),
  updateDeployment: vi.fn(),
  deleteDeployment: vi.fn(),
  getSession: vi.fn(),
  addSession: vi.fn(),
  storeNonce: vi.fn(),
  validateNonce: vi.fn(),
  getLaunchConfig: vi.fn(),
  saveLaunchConfig: vi.fn(),
  deleteRegistrationSession: vi.fn(),
  getRegistrationSession: vi.fn(),
  setRegistrationSession: vi.fn(),
});

describe('LTITool launch registration upsert', () => {
  let keyPair: CryptoKeyPair;
  let storage: LTIStorage;
  let ltiTool: LTITool;

  beforeAll(async () => {
    keyPair = await generateKeyPair('RS256');
  });

  beforeEach(() => {
    storage = createMockStorage();
    ltiTool = new LTITool({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage,
    });
  });

  it('creates client, deployment, and launch config from platform identifiers', async () => {
    vi.mocked(storage.listClients).mockResolvedValue([]);
    vi.mocked(storage.addClient).mockResolvedValue('client-internal-1');
    vi.mocked(storage.listDeployments).mockResolvedValue([]);
    vi.mocked(storage.addDeployment).mockResolvedValue('deployment-internal-1');

    const result = await ltiTool.upsertLaunchRegistration({
      iss: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      deploymentId: 'platform-deployment-id',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/jwks',
    });

    expect(storage.addClient).toHaveBeenCalledWith({
      name: 'https://platform.example.com',
      iss: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/jwks',
    });
    expect(storage.addDeployment).toHaveBeenCalledWith('client-internal-1', {
      deploymentId: 'platform-deployment-id',
    });
    expect(storage.saveLaunchConfig).toHaveBeenCalledWith({
      iss: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      deploymentId: 'platform-deployment-id',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/jwks',
    });
    expect(result).toMatchObject({
      createdClient: true,
      createdDeployment: true,
      client: {
        id: 'client-internal-1',
        clientId: 'oauth-client-id',
      },
      deployment: {
        id: 'deployment-internal-1',
        deploymentId: 'platform-deployment-id',
      },
    });
  });

  it('updates existing client endpoints and matches deployment by platform ID', async () => {
    vi.mocked(storage.listClients).mockResolvedValue([
      {
        id: 'client-internal-1',
        name: 'Existing Platform',
        iss: 'https://platform.example.com',
        clientId: 'oauth-client-id',
        authUrl: 'https://platform.example.com/old-auth',
        tokenUrl: 'https://platform.example.com/old-token',
        jwksUrl: 'https://platform.example.com/old-jwks',
      },
    ]);
    vi.mocked(storage.listDeployments).mockResolvedValue([
      {
        id: 'deployment-internal-1',
        deploymentId: 'platform-deployment-id',
        name: 'Existing Deployment',
      },
    ]);

    const result = await ltiTool.upsertLaunchRegistration({
      iss: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      deploymentId: 'platform-deployment-id',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/jwks',
    });

    expect(storage.addClient).not.toHaveBeenCalled();
    expect(storage.addDeployment).not.toHaveBeenCalled();
    expect(storage.updateClient).toHaveBeenCalledWith('client-internal-1', {
      name: 'Existing Platform',
      iss: 'https://platform.example.com',
      clientId: 'oauth-client-id',
      authUrl: 'https://platform.example.com/auth',
      tokenUrl: 'https://platform.example.com/token',
      jwksUrl: 'https://platform.example.com/jwks',
    });
    expect(storage.saveLaunchConfig).toHaveBeenCalledWith({
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
        id: 'client-internal-1',
        name: 'Existing Platform',
      },
      deployment: {
        id: 'deployment-internal-1',
        deploymentId: 'platform-deployment-id',
      },
    });
  });
});
