import type { LTIClient, LTIStorage } from '@longsightgroup/lti-tool';
import { describe, expect, it } from 'vitest';

type StorageFactory = {
  readonly createStorage: () =>
    | LTIStorage
    | Promise<LTIStorage>
    | { readonly storage: LTIStorage; readonly cleanup: () => Promise<void> }
    | Promise<{ readonly storage: LTIStorage; readonly cleanup: () => Promise<void> }>;
};

const testClient: Omit<LTIClient, 'id' | 'deployments'> = {
  name: 'Test Platform',
  iss: 'https://platform.example.com',
  clientId: 'oauth-client-id',
  authUrl: 'https://platform.example.com/auth',
  tokenUrl: 'https://platform.example.com/token',
  jwksUrl: 'https://platform.example.com/jwks',
};

export function defineStorageConformanceSuite(
  name: string,
  factory: StorageFactory,
): void {
  describe(`${name} storage conformance`, () => {
    it('looks up deployments by platform ID and updates/deletes by internal ID', async () => {
      await withStorage(factory, assertDeploymentIdContract);
    });

    it('rejects updates for missing deployments', async () => {
      await withStorage(factory, assertMissingDeploymentUpdateContract);
    });

    it('atomically rejects nonce replay', async () => {
      await withStorage(factory, assertNonceReplayContract);
    });
  });
}

async function assertDeploymentIdContract(storage: LTIStorage): Promise<void> {
  const clientId = await storage.addClient(testClient);
  const deploymentId = await storage.addDeployment(clientId, {
    deploymentId: 'platform-deployment-id',
    name: 'Original Deployment',
  });
  const otherDeploymentId = await storage.addDeployment(clientId, {
    deploymentId: 'other-platform-deployment-id',
    name: 'Other Deployment',
  });

  await assertDeploymentsListed(storage, clientId, deploymentId, otherDeploymentId);

  await expect(
    storage.getDeploymentByPlatformId(clientId, 'platform-deployment-id'),
  ).resolves.toMatchObject({
    id: deploymentId,
    deploymentId: 'platform-deployment-id',
    name: 'Original Deployment',
  });
  await expect(
    storage.getDeploymentByPlatformId(clientId, deploymentId),
  ).resolves.toBeUndefined();

  await storage.updateDeploymentById(clientId, deploymentId, {
    deploymentId: 'updated-platform-deployment-id',
    name: 'Updated Deployment',
  });

  await expect(
    storage.getDeploymentByPlatformId(clientId, 'platform-deployment-id'),
  ).resolves.toBeUndefined();
  await expect(
    storage.getDeploymentByPlatformId(clientId, 'updated-platform-deployment-id'),
  ).resolves.toMatchObject({
    id: deploymentId,
    deploymentId: 'updated-platform-deployment-id',
    name: 'Updated Deployment',
  });

  await storage.deleteDeploymentById(clientId, deploymentId);

  await expect(
    storage.getDeploymentByPlatformId(clientId, 'updated-platform-deployment-id'),
  ).resolves.toBeUndefined();
  await expect(
    storage.getDeploymentByPlatformId(clientId, 'other-platform-deployment-id'),
  ).resolves.toMatchObject({
    id: otherDeploymentId,
    deploymentId: 'other-platform-deployment-id',
  });
}

async function assertDeploymentsListed(
  storage: LTIStorage,
  clientId: string,
  deploymentId: string,
  otherDeploymentId: string,
): Promise<void> {
  await expect(storage.listDeployments(clientId)).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: deploymentId,
        deploymentId: 'platform-deployment-id',
      }),
      expect.objectContaining({
        id: otherDeploymentId,
        deploymentId: 'other-platform-deployment-id',
      }),
    ]),
  );
}

async function assertNonceReplayContract(storage: LTIStorage): Promise<void> {
  await expect(storage.validateNonce('nonce-id')).resolves.toBe(true);
  await expect(storage.validateNonce('nonce-id')).resolves.toBe(false);
}

async function assertMissingDeploymentUpdateContract(storage: LTIStorage): Promise<void> {
  const clientId = await storage.addClient(testClient);

  await expect(
    storage.updateDeploymentById(clientId, 'missing-deployment', {
      name: 'Updated',
    }),
  ).rejects.toThrow('Deployment not found');
}

async function withStorage(
  factory: StorageFactory,
  assertion: (storage: LTIStorage) => Promise<void>,
): Promise<void> {
  const context = await createStorageContext(factory);
  try {
    await assertion(context.storage);
  } finally {
    await context.cleanup();
  }
}

async function createStorageContext(
  factory: StorageFactory,
): Promise<{ readonly storage: LTIStorage; readonly cleanup: () => Promise<void> }> {
  const storageOrContext = await factory.createStorage();

  if ('storage' in storageOrContext) return storageOrContext;

  return {
    storage: storageOrContext,
    cleanup: async () => {},
  };
}
