import type { LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { lte } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  DEFAULT_NONCE_TTL_SECONDS,
  type RelationalCleanupResult,
  type RelationalSchema,
  type RelationalStorageDialect,
} from './relationalStorage.js';
import { createTenantScope } from './tenantScope.js';

type D1NonceTable = SQLiteTable & {
  readonly nonce: SQLiteColumn;
  readonly tenantId: SQLiteColumn;
  readonly expiresAt: SQLiteColumn;
};

type D1ExpiringDataTable = SQLiteTable & {
  readonly id: SQLiteColumn;
  readonly tenantId: SQLiteColumn;
  readonly data: SQLiteColumn;
  readonly expiresAt: SQLiteColumn;
};

type D1RelationalSchema = RelationalSchema & {
  readonly noncesTable: D1NonceTable;
  readonly sessionsTable: D1ExpiringDataTable;
  readonly registrationSessionsTable: D1ExpiringDataTable;
};

/** Creates the Cloudflare D1-specific relational storage dialect. */
// oxlint-disable-next-line max-lines-per-function -- dialect factory wires tenant-scoped closures.
export function createD1Dialect<TSchema extends D1RelationalSchema>(options: {
  readonly db: DrizzleD1Database<TSchema>;
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
    const result = await db
      .insert(schema.noncesTable)
      .values(
        tenant.insertValues(schema.noncesTable, {
          nonce,
          expiresAt,
        }),
      )
      .onConflictDoNothing()
      .run();

    return getD1ChangedRows(result) === 1;
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
      })
      .run();
  }

  async function cleanup(now: number): Promise<RelationalCleanupResult> {
    const expiredAt = (table: {
      readonly expiresAt: SQLiteColumn;
    }): ReturnType<typeof lte> => lte(table.expiresAt, now);

    const nonces = await db
      .delete(schema.noncesTable)
      .where(tenant.withTenant(schema.noncesTable, expiredAt(schema.noncesTable)))
      .run();
    const sessions = await db
      .delete(schema.sessionsTable)
      .where(tenant.withTenant(schema.sessionsTable, expiredAt(schema.sessionsTable)))
      .run();
    const registrationSessions = await db
      .delete(schema.registrationSessionsTable)
      .where(
        tenant.withTenant(
          schema.registrationSessionsTable,
          expiredAt(schema.registrationSessionsTable),
        ),
      )
      .run();

    return {
      noncesDeleted: getD1ChangedRows(nonces),
      sessionsDeleted: getD1ChangedRows(sessions),
      registrationSessionsDeleted: getD1ChangedRows(registrationSessions),
    };
  }

  return {
    name: 'D1',
    sessionTtlSeconds,
    nonceTtlSeconds,
    executeMutation: executeD1Mutation,
    claimNonce,
    setRegistrationSession,
    cleanup,
    orderClients: () => [schema.clientsTable.name, schema.clientsTable.id],
  };
}

async function executeD1Mutation(query: unknown): Promise<void> {
  if (!isD1MutationQuery(query)) {
    throw new Error('D1 mutation query is not runnable');
  }

  await query.run();
}

function isD1MutationQuery(
  query: unknown,
): query is { readonly run: () => Promise<unknown> } {
  return (
    typeof query === 'object' &&
    query !== null &&
    'run' in query &&
    typeof query.run === 'function'
  );
}

function getD1ChangedRows(result: {
  readonly meta?: { readonly changes?: number };
}): number {
  return result.meta?.changes ?? 0;
}
