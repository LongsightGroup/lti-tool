import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LTIDynamicRegistrationSession, LTISession } from '@longsightgroup/lti-tool';
import { Log, LogLevel, Miniflare } from 'miniflare';

import { D1Storage } from '#storage/d1';

import {
  createRelationalReset,
  createRelationalSeedHelpers,
  type RelationalTable,
  type RelationalSeedWriter,
} from './relationalHarness.js';
import type { StorageHarness } from './types.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../d1');

export class D1StorageHarness implements StorageHarness<D1Storage> {
  private readonly seedHelpers;
  private readonly mf: Miniflare;
  private readonly database: Awaited<ReturnType<Miniflare['getD1Database']>>;
  private readonly tenantId: string;
  private readonly resetTables: () => Promise<void>;

  readonly storage: D1Storage;

  private constructor(deps: {
    readonly mf: Miniflare;
    readonly database: Awaited<ReturnType<Miniflare['getD1Database']>>;
    readonly storage: D1Storage;
    readonly tenantId: string;
    readonly resetTables: () => Promise<void>;
  }) {
    this.mf = deps.mf;
    this.database = deps.database;
    this.storage = deps.storage;
    this.tenantId = deps.tenantId;
    this.resetTables = deps.resetTables;
    this.seedHelpers = createRelationalSeedHelpers(this.createSeedWriter());
  }

  static async create(tenantId = 'test-tenant'): Promise<D1StorageHarness> {
    const mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      compatibilityDate: '2026-05-07',
      d1Databases: { DB: 'test-db' },
      log: new Log(LogLevel.WARN),
    });
    const database = await mf.getD1Database('DB');
    const seedWriter = createD1SeedWriter(database, tenantId);
    const harness = new D1StorageHarness({
      mf,
      database,
      storage: new D1Storage({ database, tenantId }),
      tenantId,
      resetTables: createRelationalReset(seedWriter),
    });
    try {
      await harness.applyMigrations();
      return harness;
    } catch (error) {
      await harness.dispose();
      throw error;
    }
  }

  reset(): Promise<void> {
    return this.resetTables();
  }

  seedExpiredSession(sessionId: string, session: LTISession): Promise<void> {
    return this.seedHelpers.seedExpiredSession(sessionId, session);
  }

  seedActiveSession(
    sessionId: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    return this.seedHelpers.seedActiveSession(sessionId, payload);
  }

  seedExpiredNonce(nonce: string): Promise<void> {
    return this.seedHelpers.seedExpiredNonce(nonce);
  }

  seedActiveNonce(nonce: string): Promise<void> {
    return this.seedHelpers.seedActiveNonce(nonce);
  }

  seedExpiredRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    return this.seedHelpers.seedExpiredRegistrationSession(sessionId, session);
  }

  seedActiveRegistrationSession(
    sessionId: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    return this.seedHelpers.seedActiveRegistrationSession(sessionId, payload);
  }

  sql<T = unknown>(
    mode: 'exec' | 'first' | 'run',
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T> {
    if (mode === 'exec') {
      return this.database.exec(sql) as Promise<T>;
    }

    const statement = this.database.prepare(sql).bind(...params);
    if (mode === 'first') {
      return statement.first() as Promise<T>;
    }
    return statement.run() as Promise<T>;
  }

  async dispose(): Promise<void> {
    await this.mf.dispose();
  }

  private createSeedWriter(): RelationalSeedWriter {
    return createD1SeedWriter(this.database, this.tenantId);
  }

  private async applyMigrations(): Promise<void> {
    const migrationsDirectory = resolve(packageRoot, 'drizzle');
    const migrationFileNames = (await readdir(migrationsDirectory))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();

    for (const fileName of migrationFileNames) {
      const migration = await readFile(join(migrationsDirectory, fileName), 'utf8');
      const statements = migration
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await this.sql('run', statement);
      }
    }
  }
}

export function createD1Harness(tenantId?: string): Promise<D1StorageHarness> {
  return D1StorageHarness.create(tenantId);
}

function createD1SeedWriter(
  database: Awaited<ReturnType<Miniflare['getD1Database']>>,
  tenantId: string,
): RelationalSeedWriter {
  return {
    async resetTable(table: RelationalTable): Promise<void> {
      await database.prepare(`DELETE FROM ${table}`).run();
    },

    async insertSession(input): Promise<void> {
      await database
        .prepare(
          'INSERT INTO lti_sessions (id, tenant_id, payload, expires_at) VALUES (?, ?, ?, ?)',
        )
        .bind(input.sessionId, tenantId, input.payloadJson, input.expiresAt)
        .run();
    },

    async insertNonce(input): Promise<void> {
      await database
        .prepare('INSERT INTO lti_nonces (nonce, tenant_id, expires_at) VALUES (?, ?, ?)')
        .bind(input.nonce, tenantId, input.expiresAt)
        .run();
    },

    async insertRegistrationSession(input): Promise<void> {
      await database
        .prepare(
          'INSERT INTO lti_registration_sessions (id, tenant_id, payload, expires_at) VALUES (?, ?, ?, ?)',
        )
        .bind(input.sessionId, tenantId, input.payloadJson, input.expiresAt)
        .run();
    },
  };
}
