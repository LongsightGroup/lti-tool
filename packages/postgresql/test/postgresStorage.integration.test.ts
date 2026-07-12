import 'dotenv/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPostgresHarness,
  type PostgresStorageHarness,
} from '#test-harness/storage/postgres';
import { defineStorageConformanceSuite } from '#test-harness/storageConformance';

defineStorageConformanceSuite('PostgresStorage', {
  capabilities: {
    expiredNonces: true,
    expiredSessions: true,
    expiredRegistrationSessions: true,
  },
  createStorage: () => createPostgresHarness(),
  tenantConformance: {
    createTenantStorage: (tenantId) => createPostgresHarness(undefined, tenantId),
    tenantScopedCleanup: true,
  },
});

describe('PostgresStorage cleanup', () => {
  let harness: PostgresStorageHarness;

  beforeEach(() => {
    harness = createPostgresHarness();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it('deletes expired items', async () => {
    await harness.seedExpiredNonce('expired-nonce');

    const result = await harness.storage.cleanup();

    expect(result.noncesDeleted).toBe(1);
  });
});
