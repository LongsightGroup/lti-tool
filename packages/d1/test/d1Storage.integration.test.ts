import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { testRegistrationSession, testSession } from '#test-harness/fixtures';
import { createD1Harness, type D1StorageHarness } from '#test-harness/storage/d1';
import { defineStorageConformanceSuite } from '#test-harness/storageConformance';

defineStorageConformanceSuite('D1Storage', {
  capabilities: {
    expiredNonces: true,
    expiredSessions: true,
    expiredRegistrationSessions: true,
  },
  createStorage: () => createD1Harness(),
  tenantConformance: {
    createTenantStorage: createD1Harness,
    tenantScopedCleanup: true,
  },
});

describe('D1Storage cleanup', () => {
  let harness: D1StorageHarness;

  beforeEach(async () => {
    harness = await createD1Harness();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it('deletes expired nonces, sessions, and registration sessions', async () => {
    await harness.seedExpiredNonce('expired-nonce');
    await harness.seedActiveNonce('active-nonce');
    await harness.seedExpiredSession(
      'expired-session',
      testSession({ id: 'expired-session' }),
    );
    await harness.seedActiveSession('active-session');
    await harness.seedExpiredRegistrationSession(
      'expired-registration',
      testRegistrationSession(),
    );
    await harness.seedActiveRegistrationSession('active-registration');

    await expect(harness.storage.cleanup()).resolves.toEqual({
      noncesDeleted: 1,
      sessionsDeleted: 1,
      registrationSessionsDeleted: 1,
    });
    await expect(
      harness.sql('first', 'SELECT COUNT(*) AS count FROM lti_nonces'),
    ).resolves.toEqual({ count: 1 });
    await expect(
      harness.sql('first', 'SELECT COUNT(*) AS count FROM lti_sessions'),
    ).resolves.toEqual({ count: 1 });
    await expect(
      harness.sql('first', 'SELECT COUNT(*) AS count FROM lti_registration_sessions'),
    ).resolves.toEqual({ count: 1 });
  });
});
