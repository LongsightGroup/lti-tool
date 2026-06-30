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

type D1NonceTable = SQLiteTable & {
  readonly nonce: SQLiteColumn;
  readonly expiresAt: SQLiteColumn;
};

type D1ExpiringDataTable = SQLiteTable & {
  readonly id: SQLiteColumn;
  readonly data: SQLiteColumn;
  readonly expiresAt: SQLiteColumn;
};

type D1RelationalSchema = RelationalSchema & {
  readonly noncesTable: D1NonceTable;
  readonly sessionsTable: D1ExpiringDataTable;
  readonly registrationSessionsTable: D1ExpiringDataTable;
};

/** Creates the Cloudflare D1-specific relational storage dialect. */
export function createD1Dialect<TSchema extends D1RelationalSchema>(options: {
  readonly db: DrizzleD1Database<TSchema>;
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
    name: 'D1',
    sessionTtlSeconds,
    nonceTtlSeconds,
    executeMutation: executeD1Mutation,
    claimNonce: (nonce, expiresAt) => claimD1Nonce(db, schema, nonce, expiresAt),
    setRegistrationSession: (sessionId, session) =>
      upsertD1RegistrationSession(db, schema, sessionId, session),
    cleanup: (now) => cleanupD1(db, schema, now),
    orderClients: () => [schema.clientsTable.name, schema.clientsTable.id],
  };
}

async function claimD1Nonce<TSchema extends D1RelationalSchema>(
  db: DrizzleD1Database<TSchema>,
  schema: TSchema,
  nonce: string,
  expiresAt: number,
): Promise<boolean> {
  const result = await db
    .insert(schema.noncesTable)
    .values({
      nonce,
      expiresAt,
    })
    .onConflictDoNothing()
    .run();

  return getD1ChangedRows(result) === 1;
}

async function upsertD1RegistrationSession<TSchema extends D1RelationalSchema>(
  db: DrizzleD1Database<TSchema>,
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
    })
    .run();
}

async function cleanupD1<TSchema extends D1RelationalSchema>(
  db: DrizzleD1Database<TSchema>,
  schema: TSchema,
  now: number,
): Promise<RelationalCleanupResult> {
  const nonces = await db
    .delete(schema.noncesTable)
    .where(lte(schema.noncesTable.expiresAt, now))
    .run();
  const sessions = await db
    .delete(schema.sessionsTable)
    .where(lte(schema.sessionsTable.expiresAt, now))
    .run();
  const registrationSessions = await db
    .delete(schema.registrationSessionsTable)
    .where(lte(schema.registrationSessionsTable.expiresAt, now))
    .run();

  return {
    noncesDeleted: getD1ChangedRows(nonces),
    sessionsDeleted: getD1ChangedRows(sessions),
    registrationSessionsDeleted: getD1ChangedRows(registrationSessions),
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
