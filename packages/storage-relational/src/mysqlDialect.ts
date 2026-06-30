import type { LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { lte } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import type { MySql2Database } from 'drizzle-orm/mysql2';

import {
  DEFAULT_NONCE_TTL_SECONDS,
  type RelationalCleanupResult,
  type RelationalSchema,
  type RelationalStorageDialect,
} from './relationalStorage.js';

type MySqlRelationalSchema = RelationalSchema & {
  readonly noncesTable: MySqlTable;
  readonly sessionsTable: MySqlTable;
  readonly registrationSessionsTable: MySqlTable;
};

/** Creates the MySQL-specific relational storage dialect. */
export function createMySqlDialect<TSchema extends MySqlRelationalSchema>(options: {
  readonly db: MySql2Database<TSchema>;
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
    name: 'MySQL',
    sessionTtlSeconds,
    nonceTtlSeconds,
    claimNonce: (nonce, expiresAt) => claimMySqlNonce(db, schema, nonce, expiresAt),
    setRegistrationSession: (sessionId, session) =>
      upsertMySqlRegistrationSession(db, schema, sessionId, session),
    cleanup: (now) => cleanupMySql(db, schema, now),
  };
}

async function claimMySqlNonce<TSchema extends MySqlRelationalSchema>(
  db: MySql2Database<TSchema>,
  schema: TSchema,
  nonce: string,
  expiresAt: number,
): Promise<boolean> {
  const result = await db
    .insert(schema.noncesTable)
    .ignore()
    .values({ nonce, expiresAt });
  return getMySqlAffectedRows(result) === 1;
}

async function upsertMySqlRegistrationSession<TSchema extends MySqlRelationalSchema>(
  db: MySql2Database<TSchema>,
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
    .onDuplicateKeyUpdate({
      set: {
        data: session,
        expiresAt: session.expiresAt,
      },
    });
}

async function cleanupMySql<TSchema extends MySqlRelationalSchema>(
  db: MySql2Database<TSchema>,
  schema: TSchema,
  now: number,
): Promise<RelationalCleanupResult> {
  const noncesResult = await db
    .delete(schema.noncesTable)
    .where(lte(schema.noncesTable.expiresAt, now));
  const sessionsResult = await db
    .delete(schema.sessionsTable)
    .where(lte(schema.sessionsTable.expiresAt, now));
  const registrationSessionsResult = await db
    .delete(schema.registrationSessionsTable)
    .where(lte(schema.registrationSessionsTable.expiresAt, now));

  return {
    noncesDeleted: getMySqlAffectedRows(noncesResult),
    sessionsDeleted: getMySqlAffectedRows(sessionsResult),
    registrationSessionsDeleted: getMySqlAffectedRows(registrationSessionsResult),
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
