import type { LTIDynamicRegistrationSession, LTISession } from '@longsightgroup/lti-tool';
import mysql from 'mysql2/promise';

import { MySqlStorage } from '#storage/mysql';

import {
  createRelationalReset,
  createRelationalSeedHelpers,
  type RelationalTable,
  type RelationalSeedWriter,
} from './relationalHarness.js';
import type { StorageHarness } from './types.js';

export class MySqlStorageHarness implements StorageHarness<MySqlStorage> {
  private readonly seedHelpers;

  private constructor(
    private readonly pool: mysql.Pool,
    readonly storage: MySqlStorage,
    private readonly tenantId: string,
    private readonly resetTables: () => Promise<void>,
  ) {
    this.seedHelpers = createRelationalSeedHelpers(this.createSeedWriter());
  }

  static create(
    connectionUrl = process.env.DATABASE_URL ??
      'mysql://lti_user:lti_password@localhost:3306/lti_test',
    tenantId = 'test-tenant',
  ): MySqlStorageHarness {
    const pool = mysql.createPool({ uri: connectionUrl });
    const seedWriter = createMySqlSeedWriter(pool, tenantId);
    return new MySqlStorageHarness(
      pool,
      new MySqlStorage({ connectionUrl, pool, tenantId }),
      tenantId,
      createRelationalReset(seedWriter),
    );
  }

  reset(): Promise<void> {
    return this.resetTables();
  }

  seedExpiredSession(sessionId: string, session: LTISession): Promise<void> {
    return this.seedHelpers.seedExpiredSession(sessionId, session);
  }

  seedExpiredNonce(nonce: string): Promise<void> {
    return this.seedHelpers.seedExpiredNonce(nonce);
  }

  seedExpiredRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    return this.seedHelpers.seedExpiredRegistrationSession(sessionId, session);
  }

  async dispose(): Promise<void> {
    await this.storage.close();
  }

  private createSeedWriter(): RelationalSeedWriter {
    return createMySqlSeedWriter(this.pool, this.tenantId);
  }
}

export function createMySqlHarness(
  connectionUrl?: string,
  tenantId?: string,
): MySqlStorageHarness {
  return MySqlStorageHarness.create(connectionUrl, tenantId);
}

function createMySqlSeedWriter(pool: mysql.Pool, tenantId: string): RelationalSeedWriter {
  return {
    async resetTable(table: RelationalTable): Promise<void> {
      await pool.execute(`DELETE FROM ${table}`);
    },

    async insertSession(input): Promise<void> {
      await pool.execute(
        'INSERT INTO lti_sessions (id, tenant_id, payload, expires_at) VALUES (?, ?, ?, ?)',
        [input.sessionId, tenantId, input.payloadJson, input.expiresAt],
      );
    },

    async insertNonce(input): Promise<void> {
      await pool.execute(
        'INSERT INTO lti_nonces (nonce, tenant_id, expires_at) VALUES (?, ?, ?)',
        [input.nonce, tenantId, input.expiresAt],
      );
    },

    async insertRegistrationSession(input): Promise<void> {
      await pool.execute(
        'INSERT INTO lti_registration_sessions (id, tenant_id, payload, expires_at) VALUES (?, ?, ?, ?)',
        [input.sessionId, tenantId, input.payloadJson, input.expiresAt],
      );
    },
  };
}
