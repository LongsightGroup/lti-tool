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

type PostgresNonceTable = PgTable & {
  readonly nonce: PgColumn;
  readonly expiresAt: PgColumn;
};

type PostgresExpiringDataTable = PgTable & {
  readonly id: PgColumn;
  readonly data: PgColumn;
  readonly expiresAt: PgColumn;
};

type PostgresRelationalSchema = RelationalSchema & {
  readonly noncesTable: PostgresNonceTable;
  readonly sessionsTable: PostgresExpiringDataTable;
  readonly registrationSessionsTable: PostgresExpiringDataTable;
};

/** Creates the PostgreSQL-specific relational storage dialect. */
export function createPostgresDialect<TSchema extends PostgresRelationalSchema>(options: {
  readonly db: PostgresJsDatabase<TSchema>;
  readonly schema: TSchema;
  readonly sessionTtlSeconds: number;
  readonly nonceTtlSeconds?: number;
}): RelationalStorageDialect {
  const {
    db,
    schema,
    sessionTtlSeconds,
    nonceTtlSeconds = DEFAULT_NONCE_TTL_SECONDS,
  } = options;

  return {
    name: 'PostgreSQL',
    sessionTtlSeconds,
    nonceTtlSeconds,
    claimNonce: (nonce, expiresAt) => claimPostgresNonce(db, schema, nonce, expiresAt),
    setRegistrationSession: (sessionId, session) =>
      upsertPostgresRegistrationSession(db, schema, sessionId, session),
    cleanup: (now) => cleanupPostgres(db, schema, now),
  };
}

async function claimPostgresNonce<TSchema extends PostgresRelationalSchema>(
  db: PostgresJsDatabase<TSchema>,
  schema: TSchema,
  nonce: string,
  expiresAt: number,
): Promise<boolean> {
  const rows = await db
    .insert(schema.noncesTable)
    .values({ nonce, expiresAt })
    .onConflictDoNothing()
    .returning({ nonce: schema.noncesTable.nonce });

  return rows.length === 1;
}

async function upsertPostgresRegistrationSession<
  TSchema extends PostgresRelationalSchema,
>(
  db: PostgresJsDatabase<TSchema>,
  schema: TSchema,
  sessionId: string,
  session: LTIDynamicRegistrationSession,
): Promise<void> {
  await db
    .insert(schema.registrationSessionsTable)
    .values({
      id: sessionId,
      data: session,
      expiresAt: session.expiresAt,
    })
    .onConflictDoUpdate({
      target: schema.registrationSessionsTable.id,
      set: {
        data: session,
        expiresAt: session.expiresAt,
      },
    });
}

async function cleanupPostgres<TSchema extends PostgresRelationalSchema>(
  db: PostgresJsDatabase<TSchema>,
  schema: TSchema,
  now: number,
): Promise<RelationalCleanupResult> {
  const noncesResult = await db
    .delete(schema.noncesTable)
    .where(lte(schema.noncesTable.expiresAt, now))
    .returning({ nonce: schema.noncesTable.nonce });
  const sessionsResult = await db
    .delete(schema.sessionsTable)
    .where(lte(schema.sessionsTable.expiresAt, now))
    .returning({ id: schema.sessionsTable.id });
  const registrationSessionsResult = await db
    .delete(schema.registrationSessionsTable)
    .where(lte(schema.registrationSessionsTable.expiresAt, now))
    .returning({ id: schema.registrationSessionsTable.id });

  return {
    noncesDeleted: noncesResult.length,
    sessionsDeleted: sessionsResult.length,
    registrationSessionsDeleted: registrationSessionsResult.length,
  };
}
