import type { LTIStorage } from '@longsightgroup/lti-tool';
import { describe, expect, it } from 'vitest';

import {
  testClient,
  testDeployment,
  testLaunchConfig,
  testRegistrationSession,
  testSession,
} from './fixtures.js';
import type { StorageHarness } from './storage/types.js';

type StorageCapabilities = {
  readonly expiredSessions?: boolean;
  readonly expiredNonces?: boolean;
  readonly expiredRegistrationSessions?: boolean;
};

type TenantConformance = {
  readonly createTenantStorage: (
    tenantId: string,
  ) => StorageHarness | Promise<StorageHarness>;
  readonly tenantScopedCleanup?: boolean;
};

type StorageFactory = {
  readonly createStorage: () => StorageHarness | Promise<StorageHarness>;
  readonly capabilities?: StorageCapabilities;
  readonly tenantConformance?: TenantConformance;
};

export function defineStorageConformanceSuite(
  name: string,
  factory: StorageFactory,
): void {
  describe(`${name} storage conformance`, () => {
    defineClientConformance(factory);
    defineDeploymentConformance(factory);
    defineSessionConformance(factory);
    defineNonceConformance(factory);
    defineLaunchConfigConformance(factory);
    defineRegistrationSessionConformance(factory);
    defineTenantIsolationConformance(factory);
  });
}

function defineClientConformance(factory: StorageFactory): void {
  it('manages clients through add/get/list/update/delete', () =>
    withStorage(factory, ({ storage }) => assertClientContract(storage)));

  it('rejects updates for missing clients', () =>
    withStorage(factory, ({ storage }) => assertMissingClientUpdateContract(storage)));

  it('treats missing client deletion as idempotent', () =>
    withStorage(factory, ({ storage }) => assertMissingClientDeleteContract(storage)));
}

function defineDeploymentConformance(factory: StorageFactory): void {
  it('manages deployments by platform ID and internal ID', () =>
    withStorage(factory, ({ storage }) => assertDeploymentIdContract(storage)));

  it('rejects deployment creation for missing clients', () =>
    withStorage(factory, ({ storage }) =>
      assertMissingClientDeploymentCreateContract(storage),
    ));

  it('rejects updates for missing deployments', () =>
    withStorage(factory, ({ storage }) =>
      assertMissingDeploymentUpdateContract(storage),
    ));

  it('treats missing deployment deletion as idempotent', () =>
    withStorage(factory, ({ storage }) =>
      assertMissingDeploymentDeleteContract(storage),
    ));
}

function defineSessionConformance(factory: StorageFactory): void {
  it('round-trips sessions and returns undefined for missing sessions', () =>
    withStorage(factory, ({ storage }) => assertSessionContract(storage)));

  if (factory.capabilities?.expiredSessions !== true) return;

  it('does not retrieve expired sessions', () =>
    withStorage(factory, assertExpiredSessionContract));
}

function defineNonceConformance(factory: StorageFactory): void {
  it('atomically rejects nonce replay', () =>
    withStorage(factory, ({ storage }) => assertNonceReplayContract(storage)));

  if (factory.capabilities?.expiredNonces !== true) return;

  it('rejects expired nonces still present before cleanup', () =>
    withStorage(factory, assertExpiredNonceContract));
}

function defineLaunchConfigConformance(factory: StorageFactory): void {
  it('resolves launch config by exact platform deployment ID', () =>
    withStorage(factory, ({ storage }) => assertLaunchConfigContract(storage)));

  it('resolves launch config by updated platform deployment ID', () =>
    withStorage(factory, ({ storage }) =>
      assertLaunchConfigAfterDeploymentUpdateContract(storage),
    ));

  it('returns undefined for missing launch config without storage-level fallback', () =>
    withStorage(factory, ({ storage }) => assertMissingLaunchConfigContract(storage)));
}

function defineRegistrationSessionConformance(factory: StorageFactory): void {
  it('round-trips and deletes registration sessions', () =>
    withStorage(factory, ({ storage }) => assertRegistrationSessionContract(storage)));

  it('upserts registration sessions on retry', () =>
    withStorage(factory, ({ storage }) =>
      assertRegistrationSessionUpsertContract(storage),
    ));

  if (factory.capabilities?.expiredRegistrationSessions !== true) return;

  it('does not retrieve expired registration sessions', () =>
    withStorage(factory, assertExpiredRegistrationSessionContract));
}

function defineTenantIsolationConformance(factory: StorageFactory): void {
  const tenantConformance = factory.tenantConformance;
  if (tenantConformance === undefined) return;

  it('isolates client data across tenant-bound storage instances', () =>
    withTenantPair(tenantConformance, async (tenantA, tenantB) => {
      const clientId = await tenantA.storage.addClient(testClient());
      await expect(tenantB.storage.getClientById(clientId)).resolves.toBeUndefined();
      await expect(tenantA.storage.getClientById(clientId)).resolves.toMatchObject({
        id: clientId,
      });
    }));

  it('keeps nonce namespaces independent per tenant', () =>
    withTenantPair(tenantConformance, async (tenantA, tenantB) => {
      await expect(tenantA.storage.validateNonce('shared-nonce')).resolves.toBe(true);
      await expect(tenantB.storage.validateNonce('shared-nonce')).resolves.toBe(true);
      await expect(tenantA.storage.validateNonce('shared-nonce')).resolves.toBe(false);
    }));

  it('keeps sessions with the same ID separate per tenant', () =>
    withTenantPair(tenantConformance, assertTenantSessionIsolation));

  it('upserts registration sessions with the same ID per tenant', () =>
    withTenantPair(tenantConformance, assertTenantRegistrationSessionIsolation));

  if (tenantConformance.tenantScopedCleanup !== true) return;

  it('scopes cleanup to the configured tenant', () =>
    withTenantPair(tenantConformance, async (tenantA, tenantB) => {
      expect(tenantA.seedExpiredNonce).toBeDefined();
      expect(tenantB.seedExpiredNonce).toBeDefined();
      expect('cleanup' in tenantA.storage).toBe(true);

      await tenantA.seedExpiredNonce!('tenant-a-expired-nonce');
      await tenantB.seedExpiredNonce!('tenant-b-expired-nonce');

      const cleanup = (
        tenantA.storage as StorageHarness['storage'] & {
          cleanup: () => Promise<{ noncesDeleted: number }>;
        }
      ).cleanup;
      const result = await cleanup.call(tenantA.storage);

      expect(result.noncesDeleted).toBe(1);
      await expect(tenantB.storage.validateNonce('tenant-b-expired-nonce')).resolves.toBe(
        false,
      );
    }));
}

async function assertTenantSessionIsolation(
  tenantA: StorageHarness,
  tenantB: StorageHarness,
): Promise<void> {
  const sessionId = 'shared-session-id';
  await tenantA.storage.addSession(
    testSession({ id: sessionId, user: { id: 'tenant-a-user', roles: ['Learner'] } }),
  );
  await tenantB.storage.addSession(
    testSession({ id: sessionId, user: { id: 'tenant-b-user', roles: ['Learner'] } }),
  );

  await expect(tenantA.storage.getSession(sessionId)).resolves.toMatchObject({
    user: { id: 'tenant-a-user' },
  });
  await expect(tenantB.storage.getSession(sessionId)).resolves.toMatchObject({
    user: { id: 'tenant-b-user' },
  });
}

async function assertTenantRegistrationSessionIsolation(
  tenantA: StorageHarness,
  tenantB: StorageHarness,
): Promise<void> {
  const sessionId = 'shared-registration-session-id';
  await tenantA.storage.setRegistrationSession(
    sessionId,
    testRegistrationSession({ registrationToken: 'tenant-a-token' }),
  );
  await tenantB.storage.setRegistrationSession(
    sessionId,
    testRegistrationSession({ registrationToken: 'tenant-b-token' }),
  );

  await expect(tenantA.storage.getRegistrationSession(sessionId)).resolves.toMatchObject({
    registrationToken: 'tenant-a-token',
  });
  await expect(tenantB.storage.getRegistrationSession(sessionId)).resolves.toMatchObject({
    registrationToken: 'tenant-b-token',
  });
}

async function assertClientContract(storage: LTIStorage): Promise<void> {
  const client = testClient();
  const clientId = await storage.addClient(client);
  const deploymentId = await storage.addDeployment(clientId, testDeployment());

  await expect(storage.getClientById(clientId)).resolves.toMatchObject({
    id: clientId,
    ...client,
    deployments: [
      expect.objectContaining({
        id: deploymentId,
        deploymentId: 'platform-deployment-id',
      }),
    ],
  });

  const clients = await storage.listClients();
  expect(clients).toEqual([
    expect.objectContaining({
      id: clientId,
      clientId: client.clientId,
      iss: client.iss,
    }),
  ]);
  expect(clients[0]).not.toHaveProperty('deployments');

  await storage.updateClient(clientId, {
    name: 'Updated Platform',
    authUrl: 'https://platform.example.com/updated-auth',
  });

  await expect(storage.getClientById(clientId)).resolves.toMatchObject({
    id: clientId,
    name: 'Updated Platform',
    authUrl: 'https://platform.example.com/updated-auth',
  });

  await storage.deleteClient(clientId);

  await expect(storage.getClientById(clientId)).resolves.toBeUndefined();
  await expect(storage.listDeployments(clientId)).resolves.toEqual([]);
  await expect(
    storage.getDeploymentByPlatformId(clientId, 'platform-deployment-id'),
  ).resolves.toBeUndefined();
}

async function assertMissingClientUpdateContract(storage: LTIStorage): Promise<void> {
  await expect(
    storage.updateClient('missing-client', { name: 'Updated' }),
  ).rejects.toThrow('Client not found');
}

async function assertMissingClientDeleteContract(storage: LTIStorage): Promise<void> {
  await expect(storage.deleteClient('missing-client')).resolves.toBeUndefined();
}

async function assertDeploymentIdContract(storage: LTIStorage): Promise<void> {
  const clientId = await storage.addClient(testClient());
  const deploymentId = await storage.addDeployment(clientId, {
    deploymentId: 'platform-deployment-id',
    name: 'Original Deployment',
  });
  const otherDeploymentId = await storage.addDeployment(clientId, {
    deploymentId: 'other-platform-deployment-id',
    name: 'Other Deployment',
  });

  await assertDeploymentLookup(storage, clientId, deploymentId, otherDeploymentId);

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
  await expect(storage.listDeployments(clientId)).resolves.toEqual([
    expect.objectContaining({
      id: otherDeploymentId,
      deploymentId: 'other-platform-deployment-id',
    }),
  ]);
}

async function assertDeploymentLookup(
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
}

async function assertMissingClientDeploymentCreateContract(
  storage: LTIStorage,
): Promise<void> {
  await expect(storage.addDeployment('missing-client', testDeployment())).rejects.toThrow(
    'Client not found',
  );
}

async function assertMissingDeploymentUpdateContract(storage: LTIStorage): Promise<void> {
  const clientId = await storage.addClient(testClient());

  await expect(
    storage.updateDeploymentById(clientId, 'missing-deployment', {
      name: 'Updated',
    }),
  ).rejects.toThrow('Deployment not found');
}

async function assertMissingDeploymentDeleteContract(storage: LTIStorage): Promise<void> {
  const clientId = await storage.addClient(testClient());

  await expect(
    storage.deleteDeploymentById(clientId, 'missing-deployment'),
  ).resolves.toBeUndefined();
}

async function assertSessionContract(storage: LTIStorage): Promise<void> {
  const session = testSession();

  await expect(storage.getSession('missing-session')).resolves.toBeUndefined();
  await expect(storage.addSession(session)).resolves.toBe(session.id);
  await expect(storage.getSession(session.id)).resolves.toMatchObject({
    id: session.id,
    user: session.user,
    platform: session.platform,
  });
}

async function assertExpiredSessionContract(harness: StorageHarness): Promise<void> {
  expect(harness.seedExpiredSession).toBeDefined();
  await harness.seedExpiredSession?.('expired-session', testSession());

  await expect(harness.storage.getSession('expired-session')).resolves.toBeUndefined();
}

async function assertNonceReplayContract(storage: LTIStorage): Promise<void> {
  await expect(storage.validateNonce('nonce-id')).resolves.toBe(true);
  await expect(storage.validateNonce('nonce-id')).resolves.toBe(false);
}

async function assertExpiredNonceContract(harness: StorageHarness): Promise<void> {
  expect(harness.seedExpiredNonce).toBeDefined();
  await harness.seedExpiredNonce?.('expired-nonce');

  await expect(harness.storage.validateNonce('expired-nonce')).resolves.toBe(false);
}

async function assertLaunchConfigContract(storage: LTIStorage): Promise<void> {
  const client = testClient();
  const clientId = await storage.addClient(client);
  await storage.addDeployment(clientId, testDeployment());
  const launchConfig = testLaunchConfig();

  await storage.saveLaunchConfig(launchConfig);

  await expect(
    storage.getLaunchConfig(client.iss, client.clientId, launchConfig.deploymentId),
  ).resolves.toMatchObject(launchConfig);
}

async function assertLaunchConfigAfterDeploymentUpdateContract(
  storage: LTIStorage,
): Promise<void> {
  const client = testClient();
  const clientId = await storage.addClient(client);
  const internalDeploymentId = await storage.addDeployment(clientId, {
    deploymentId: 'old-platform-deployment-id',
  });

  await storage.updateDeploymentById(clientId, internalDeploymentId, {
    deploymentId: 'new-platform-deployment-id',
  });

  await expect(
    storage.getLaunchConfig(client.iss, client.clientId, 'old-platform-deployment-id'),
  ).resolves.toBeUndefined();
  await expect(
    storage.getLaunchConfig(client.iss, client.clientId, 'new-platform-deployment-id'),
  ).resolves.toMatchObject({
    iss: client.iss,
    clientId: client.clientId,
    deploymentId: 'new-platform-deployment-id',
  });
}

async function assertMissingLaunchConfigContract(storage: LTIStorage): Promise<void> {
  const client = testClient();
  const clientId = await storage.addClient(client);
  await storage.addDeployment(clientId, { deploymentId: 'default' });

  await expect(
    storage.getLaunchConfig(client.iss, client.clientId, 'missing-deployment'),
  ).resolves.toBeUndefined();
}

async function assertRegistrationSessionContract(storage: LTIStorage): Promise<void> {
  const session = testRegistrationSession();

  await storage.setRegistrationSession('registration-session-id', session);
  await expect(
    storage.getRegistrationSession('registration-session-id'),
  ).resolves.toEqual(session);

  await storage.deleteRegistrationSession('registration-session-id');
  await expect(
    storage.getRegistrationSession('registration-session-id'),
  ).resolves.toBeUndefined();
}

async function assertRegistrationSessionUpsertContract(
  storage: LTIStorage,
): Promise<void> {
  const session = testRegistrationSession();

  await storage.setRegistrationSession('registration-session-id', session);
  await storage.setRegistrationSession('registration-session-id', {
    ...session,
    registrationToken: 'updated-token',
  });

  await expect(
    storage.getRegistrationSession('registration-session-id'),
  ).resolves.toMatchObject({
    registrationToken: 'updated-token',
    expiresAt: session.expiresAt,
  });
}

async function assertExpiredRegistrationSessionContract(
  harness: StorageHarness,
): Promise<void> {
  expect(harness.seedExpiredRegistrationSession).toBeDefined();
  await harness.seedExpiredRegistrationSession?.(
    'expired-registration-session',
    testRegistrationSession(),
  );

  await expect(
    harness.storage.getRegistrationSession('expired-registration-session'),
  ).resolves.toBeUndefined();
}

async function withStorage(
  factory: StorageFactory,
  assertion: (harness: StorageHarness) => Promise<void>,
): Promise<void> {
  const harness = await factory.createStorage();
  try {
    await harness.reset();
    await assertion(harness);
  } finally {
    await harness.dispose();
  }
}

async function withTenantPair(
  tenantConformance: TenantConformance,
  assertion: (tenantA: StorageHarness, tenantB: StorageHarness) => Promise<void>,
): Promise<void> {
  const tenantA = await tenantConformance.createTenantStorage('conformance-tenant-a');
  const tenantB = await tenantConformance.createTenantStorage('conformance-tenant-b');
  try {
    await tenantA.reset();
    await tenantB.reset();
    await assertion(tenantA, tenantB);
  } finally {
    await Promise.all([tenantA.dispose(), tenantB.dispose()]);
  }
}
