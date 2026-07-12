import 'dotenv/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createMySqlHarness,
  type MySqlStorageHarness,
} from '#test-harness/storage/mysql';
import { defineStorageConformanceSuite } from '#test-harness/storageConformance';

defineStorageConformanceSuite('MySqlStorage', {
  capabilities: {
    expiredNonces: true,
    expiredSessions: true,
    expiredRegistrationSessions: true,
  },
  createStorage: () => createMySqlHarness(),
  tenantConformance: {
    createTenantStorage: (tenantId) => createMySqlHarness(undefined, tenantId),
    tenantScopedCleanup: true,
  },
});

describe('MySqlStorage cleanup', () => {
  let harness: MySqlStorageHarness;

  beforeEach(() => {
    harness = createMySqlHarness();
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
