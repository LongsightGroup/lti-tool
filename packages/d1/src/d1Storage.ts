import { type LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { eq, lte } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import { toDeploymentInsertRow } from '#storage/drizzle-deployment-row';
import {
  RelationalStorage,
  type RelationalCleanupResult,
  type RelationalDatabase,
  type RelationalStorageDialect,
  resolveStorageLogger,
} from '#storage/relational-storage';

import { NONCE_TTL, SESSION_TTL } from './cacheConfig.js';
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
      db: db as unknown as RelationalDatabase,
      schema,
      dialect: createD1Dialect(db),
    });
  }
}

function createD1Dialect(db: DrizzleD1Database<typeof schema>): RelationalStorageDialect {
  return {
    name: 'D1',
    sessionTtlSeconds: SESSION_TTL,
    insertClient: (client) => insertD1Client(db, client),
    insertDeployment: (clientId, deployment) =>
      insertD1Deployment(db, clientId, deployment),
    executeMutation: executeD1Mutation,
    deleteClient: (clientId) => deleteD1Client(db, clientId),
    insertSession: (session, expiresAt) => insertD1Session(db, session, expiresAt),
    validateNonce: (nonce) => validateD1Nonce(db, nonce),
    serializeDate: (date) => date.toISOString(),
    setRegistrationSession: (sessionId, session) =>
      setD1RegistrationSession(db, sessionId, session),
    cleanup: (now) => cleanupD1(db, now),
    orderClients: () => [schema.clientsTable.name, schema.clientsTable.id],
  };
}

async function insertD1Client(
  db: DrizzleD1Database<typeof schema>,
  client: Parameters<RelationalStorageDialect['insertClient']>[0],
): Promise<string> {
  const clientId = crypto.randomUUID();
  await db
    .insert(schema.clientsTable)
    .values({
      id: clientId,
      ...client,
    })
    .run();
  return clientId;
}

async function insertD1Deployment(
  db: DrizzleD1Database<typeof schema>,
  clientId: string,
  deployment: Parameters<RelationalStorageDialect['insertDeployment']>[1],
): Promise<string> {
  const deploymentInternalId = crypto.randomUUID();
  await db
    .insert(schema.deploymentsTable)
    .values({
      id: deploymentInternalId,
      clientId,
      ...toDeploymentInsertRow(deployment),
    })
    .run();
  return deploymentInternalId;
}

async function deleteD1Client(
  db: DrizzleD1Database<typeof schema>,
  clientId: string,
): Promise<void> {
  await db
    .delete(schema.deploymentsTable)
    .where(eq(schema.deploymentsTable.clientId, clientId))
    .run();
  await db.delete(schema.clientsTable).where(eq(schema.clientsTable.id, clientId)).run();
}

async function validateD1Nonce(
  db: DrizzleD1Database<typeof schema>,
  nonce: string,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .insert(schema.noncesTable)
    .values({
      nonce,
      expiresAt: new Date(now.getTime() + NONCE_TTL * 1000).toISOString(),
      usedAt: now.toISOString(),
    })
    .onConflictDoNothing()
    .run();

  return getChangedRows(result) === 1;
}

async function insertD1Session(
  db: DrizzleD1Database<typeof schema>,
  session: Parameters<RelationalStorageDialect['insertSession']>[0],
  expiresAt: Parameters<RelationalStorageDialect['insertSession']>[1],
): Promise<void> {
  const { id, ...data } = session;
  const sessionExpiresAt =
    typeof expiresAt === 'string' ? expiresAt : expiresAt.toISOString();
  await db
    .insert(schema.sessionsTable)
    .values({
      id,
      data,
      expiresAt: sessionExpiresAt,
    })
    .run();
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
      expiresAt: new Date(session.expiresAt).toISOString(),
    })
    .onConflictDoUpdate({
      target: schema.registrationSessionsTable.id,
      set: {
        data: session,
        expiresAt: new Date(session.expiresAt).toISOString(),
      },
    })
    .run();
}

async function cleanupD1(
  db: DrizzleD1Database<typeof schema>,
  now: Date,
): Promise<RelationalCleanupResult> {
  const nowIso = now.toISOString();
  const nonces = await db
    .delete(schema.noncesTable)
    .where(lte(schema.noncesTable.expiresAt, nowIso))
    .run();
  const sessions = await db
    .delete(schema.sessionsTable)
    .where(lte(schema.sessionsTable.expiresAt, nowIso))
    .run();
  const registrationSessions = await db
    .delete(schema.registrationSessionsTable)
    .where(lte(schema.registrationSessionsTable.expiresAt, nowIso))
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
