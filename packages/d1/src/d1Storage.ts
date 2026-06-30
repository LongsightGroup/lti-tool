import { type LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { lte } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import {
  RelationalStorage,
  DEFAULT_NONCE_TTL_SECONDS,
  DEFAULT_SESSION_TTL_SECONDS,
  type RelationalDatabase,
  type RelationalCleanupResult,
  type RelationalStorageDialect,
  resolveStorageLogger,
} from '#storage/relational-storage';

import * as schema from './db/schema/index.js';
import type { D1StorageConfig } from './interfaces/d1StorageConfig.js';

/**
 * Cloudflare D1 implementation of LTI storage interface.
 */
export class D1Storage extends RelationalStorage {
  constructor(config: D1StorageConfig) {
    const logger = resolveStorageLogger(config.logger);
    const db = drizzle(config.database, { schema });

    super({
      logger,
      // SAFETY: D1 Drizzle exposes the select/insert/update/delete query surface used by RelationalStorage.
      db: db as unknown as RelationalDatabase,
      schema,
      dialect: createD1Dialect(db),
    });
  }
}

function createD1Dialect(db: DrizzleD1Database<typeof schema>): RelationalStorageDialect {
  return {
    name: 'D1',
    sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
    nonceTtlSeconds: DEFAULT_NONCE_TTL_SECONDS,
    executeMutation: executeD1Mutation,
    claimNonce: (nonce, expiresAt) => claimD1Nonce(db, nonce, expiresAt),
    setRegistrationSession: (sessionId, session) =>
      setD1RegistrationSession(db, sessionId, session),
    cleanup: (now) => cleanupD1(db, now),
    orderClients: () => [schema.clientsTable.name, schema.clientsTable.id],
  };
}

async function claimD1Nonce(
  db: DrizzleD1Database<typeof schema>,
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

  return getChangedRows(result) === 1;
}

async function setD1RegistrationSession(
  db: DrizzleD1Database<typeof schema>,
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

async function cleanupD1(
  db: DrizzleD1Database<typeof schema>,
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
    noncesDeleted: getChangedRows(nonces),
    sessionsDeleted: getChangedRows(sessions),
    registrationSessionsDeleted: getChangedRows(registrationSessions),
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

function getChangedRows(result: {
  readonly meta?: { readonly changes?: number };
}): number {
  return result.meta?.changes ?? 0;
}
