import type { LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { lte } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import type { MySql2Database } from 'drizzle-orm/mysql2';

import {
  DEFAULT_NONCE_TTL_SECONDS,
  type RelationalCleanupResult,
  type RelationalSchema,
  type RelationalStorageDialect,
} from './relationalStorage.js';
import { createTenantScope } from './tenantScope.js';

type MySqlNonceTable = MySqlTable & {
  readonly nonce: MySqlColumn;
  readonly tenantId: MySqlColumn;
  readonly expiresAt: MySqlColumn;
};

type MySqlExpiringDataTable = MySqlTable & {
  readonly id: MySqlColumn;
  readonly tenantId: MySqlColumn;
  readonly data: MySqlColumn;
  readonly expiresAt: MySqlColumn;
};

type MySqlRelationalSchema = RelationalSchema & {
  readonly noncesTable: MySqlNonceTable;
  readonly sessionsTable: MySqlExpiringDataTable;
  readonly registrationSessionsTable: MySqlExpiringDataTable;
};

/** Creates the MySQL-specific relational storage dialect. */
// oxlint-disable-next-line max-lines-per-function -- dialect factory wires tenant-scoped closures.
export function createMySqlDialect<TSchema extends MySqlRelationalSchema>(options: {
  readonly db: MySql2Database<TSchema>;
  readonly schema: TSchema;
  readonly sessionTtlSeconds: number;
  readonly nonceTtlSeconds?: number;
  readonly tenantId: string;
}): RelationalStorageDialect {
  const {
    db,
    schema,
    sessionTtlSeconds,
    nonceTtlSeconds = DEFAULT_NONCE_TTL_SECONDS,
    tenantId,
  } = options;
  const tenant = createTenantScope(tenantId);

  async function claimNonce(nonce: string, expiresAt: number): Promise<boolean> {
    const result = await db.insert(schema.noncesTable).ignore().values(
      tenant.insertValues(schema.noncesTable, {
        nonce,
        expiresAt,
      }),
    );
    return getMySqlAffectedRows(result) === 1;
  }

  async function setRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    await db
      .insert(schema.registrationSessionsTable)
      .values(
        tenant.insertValues(schema.registrationSessionsTable, {
          id: sessionId,
          data: session,
          expiresAt: session.expiresAt,
        }),
      )
      .onDuplicateKeyUpdate({
        set: {
          data: session,
          expiresAt: session.expiresAt,
        },
      });
  }

  async function cleanup(now: number): Promise<RelationalCleanupResult> {
    const noncesResult = await db
      .delete(schema.noncesTable)
      .where(
        tenant.withTenant(schema.noncesTable, lte(schema.noncesTable.expiresAt, now)),
      );
    const sessionsResult = await db
      .delete(schema.sessionsTable)
      .where(
        tenant.withTenant(schema.sessionsTable, lte(schema.sessionsTable.expiresAt, now)),
      );
    const registrationSessionsResult = await db
      .delete(schema.registrationSessionsTable)
      .where(
        tenant.withTenant(
          schema.registrationSessionsTable,
          lte(schema.registrationSessionsTable.expiresAt, now),
        ),
      );

    return {
      noncesDeleted: getMySqlAffectedRows(noncesResult),
      sessionsDeleted: getMySqlAffectedRows(sessionsResult),
      registrationSessionsDeleted: getMySqlAffectedRows(registrationSessionsResult),
    };
  }

  return {
    name: 'MySQL',
    sessionTtlSeconds,
    nonceTtlSeconds,
    claimNonce,
    setRegistrationSession,
    cleanup,
  };
}

/** Extracts affected row count from mysql2 mutation results. */
export function getMySqlAffectedRows(result: unknown): number {
  if (!Array.isArray(result)) return 0;

  const [summary] = result;
  if (typeof summary !== 'object' || summary === null || !('affectedRows' in summary)) {
    return 0;
  }

  return Number(summary.affectedRows ?? 0);
}
