import type { LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { lte } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  DEFAULT_NONCE_TTL_SECONDS,
  type RelationalCleanupResult,
  type RelationalSchema,
  type RelationalStorageDialect,
} from './relationalStorage.js';
import { createTenantScope } from './tenantScope.js';

type PostgresNonceTable = PgTable & {
  readonly nonce: PgColumn;
  readonly tenantId: PgColumn;
  readonly expiresAt: PgColumn;
};

type PostgresExpiringDataTable = PgTable & {
  readonly id: PgColumn;
  readonly tenantId: PgColumn;
  readonly data: PgColumn;
  readonly expiresAt: PgColumn;
};

type PostgresRelationalSchema = RelationalSchema & {
  readonly noncesTable: PostgresNonceTable;
  readonly sessionsTable: PostgresExpiringDataTable;
  readonly registrationSessionsTable: PostgresExpiringDataTable;
};

/** Creates the PostgreSQL-specific relational storage dialect. */
// oxlint-disable-next-line max-lines-per-function -- dialect factory wires tenant-scoped closures.
export function createPostgresDialect<TSchema extends PostgresRelationalSchema>(options: {
  readonly db: PostgresJsDatabase<TSchema>;
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
    const rows = await db
      .insert(schema.noncesTable)
      .values(
        tenant.insertValues(schema.noncesTable, {
          nonce,
          expiresAt,
        }),
      )
      .onConflictDoNothing()
      .returning({ nonce: schema.noncesTable.nonce });

    return rows.length === 1;
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
      .onConflictDoUpdate({
        target: [
          schema.registrationSessionsTable.tenantId,
          schema.registrationSessionsTable.id,
        ],
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
      )
      .returning({ nonce: schema.noncesTable.nonce });
    const sessionsResult = await db
      .delete(schema.sessionsTable)
      .where(
        tenant.withTenant(schema.sessionsTable, lte(schema.sessionsTable.expiresAt, now)),
      )
      .returning({ id: schema.sessionsTable.id });
    const registrationSessionsResult = await db
      .delete(schema.registrationSessionsTable)
      .where(
        tenant.withTenant(
          schema.registrationSessionsTable,
          lte(schema.registrationSessionsTable.expiresAt, now),
        ),
      )
      .returning({ id: schema.registrationSessionsTable.id });

    return {
      noncesDeleted: noncesResult.length,
      sessionsDeleted: sessionsResult.length,
      registrationSessionsDeleted: registrationSessionsResult.length,
    };
  }

  return {
    name: 'PostgreSQL',
    sessionTtlSeconds,
    nonceTtlSeconds,
    claimNonce,
    setRegistrationSession,
    cleanup,
  };
}
