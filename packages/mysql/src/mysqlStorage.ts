import { isServerlessEnvironment } from '@longsightgroup/lti-tool';
import { and, eq, gt, lt } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import type { Logger } from 'pino';

import { toDeploymentInsertRow } from '#storage/drizzle-deployment-row';
import {
  RelationalStorage,
  type RelationalCleanupResult,
  type RelationalDatabase,
  type RelationalStorageDialect,
  resolveStorageLogger,
  validateNonceSelectThenInsert,
} from '#storage/relational-storage';

import { NONCE_TTL, SESSION_TTL } from './cacheConfig.js';
import * as schema from './db/schema/index.js';
import type { MySqlStorageConfig } from './interfaces/mySqlStorageConfig.js';

/**
 * MySQL implementation of LTI storage interface.
 */
export class MySqlStorage extends RelationalStorage {
  private readonly adapterLogger: Logger;
  private readonly pool: mysql.Pool;

  constructor(config: MySqlStorageConfig) {
    const logger = resolveStorageLogger(config.logger);
    const connectionOptions = resolveConnectionOptions(config, logger);
    const pool = mysql.createPool({
      uri: config.connectionUrl,
      connectionLimit: connectionOptions.connectionLimit,
      queueLimit: connectionOptions.queueLimit,
    });
    const db = drizzle(pool, { schema, mode: 'default' });

    super({
      logger,
      db: db as unknown as RelationalDatabase,
      schema,
      dialect: createMySqlDialect(db),
    });

    this.adapterLogger = logger;
    this.pool = pool;

    this.adapterLogger.debug(connectionOptions, 'MySQL connection pool initialized');
  }

  /**
   * Close the MySQL connection pool.
   */
  async close(): Promise<void> {
    this.adapterLogger.debug('closing MySQL connection pool');
    await this.pool.end();
    this.adapterLogger.debug('MySQL connection pool closed');
  }
}

function createMySqlDialect(db: MySql2Database<typeof schema>): RelationalStorageDialect {
  return {
    name: 'MySQL',
    sessionTtlSeconds: SESSION_TTL,
    insertClient: async (client) => {
      const clientId = crypto.randomUUID();
      await db.insert(schema.clientsTable).values({
        id: clientId,
        ...client,
      });
      return clientId;
    },
    insertDeployment: async (clientId, deployment) => {
      const deploymentInternalId = crypto.randomUUID();
      await db.insert(schema.deploymentsTable).values({
        id: deploymentInternalId,
        clientId,
        ...toDeploymentInsertRow(deployment),
      });
      return deploymentInternalId;
    },
    deleteClient: (clientId) => deleteMySqlClient(db, clientId),
    requireExistingClientBeforeDelete: true,
    insertSession: async (session, expiresAt) => {
      const { id, ...data } = session;
      const sessionExpiresAt =
        expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
      await db.insert(schema.sessionsTable).values({
        id,
        data,
        expiresAt: sessionExpiresAt,
      });
    },
    validateNonce: (nonce) => validateMySqlNonce(db, nonce),
    serializeDate: (date) => date,
    setRegistrationSession: async (sessionId, session) => {
      await db.insert(schema.registrationSessionsTable).values({
        id: sessionId,
        data: session,
        expiresAt: new Date(session.expiresAt),
      });
    },
    cleanup: (now) => cleanupMySql(db, now),
  };
}

async function deleteMySqlClient(
  db: MySql2Database<typeof schema>,
  clientId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.deploymentsTable)
      .where(eq(schema.deploymentsTable.clientId, clientId));
    await tx.delete(schema.clientsTable).where(eq(schema.clientsTable.id, clientId));
  });
}

function validateMySqlNonce(
  db: MySql2Database<typeof schema>,
  nonce: string,
): Promise<boolean> {
  return validateNonceSelectThenInsert(db, nonce, {
    nonceTtlSeconds: NONCE_TTL,
    isDuplicateKeyError: isMySqlDuplicateKey,
    selectExistingNonce: selectExistingMySqlNonce,
    insertNonce: insertMySqlNonce,
  });
}

async function cleanupMySql(
  db: MySql2Database<typeof schema>,
  now: Date,
): Promise<RelationalCleanupResult> {
  const noncesResult = await db
    .delete(schema.noncesTable)
    .where(lt(schema.noncesTable.expiresAt, now));
  const sessionsResult = await db
    .delete(schema.sessionsTable)
    .where(lt(schema.sessionsTable.expiresAt, now));
  const registrationSessionsResult = await db
    .delete(schema.registrationSessionsTable)
    .where(lt(schema.registrationSessionsTable.expiresAt, now));

  return {
    noncesDeleted: getMySqlAffectedRows(noncesResult),
    sessionsDeleted: getMySqlAffectedRows(sessionsResult),
    registrationSessionsDeleted: getMySqlAffectedRows(registrationSessionsResult),
  };
}

function resolveConnectionOptions(
  config: MySqlStorageConfig,
  logger: Logger,
): {
  readonly connectionLimit: number;
  readonly isServerless: boolean;
  readonly queueLimit: number;
} {
  const isServerless = isServerlessEnvironment();
  const defaultConnectionLimit = isServerless ? 1 : 10;
  const connectionLimit = config.poolOptions?.connectionLimit ?? defaultConnectionLimit;

  if (isServerless && connectionLimit > 5) {
    logger.warn(
      { connectionLimit, environment: 'serverless' },
      'High connectionLimit detected in serverless environment. Consider using 1 connection per container to avoid wasting resources.',
    );
  }

  return {
    connectionLimit,
    isServerless,
    queueLimit: config.poolOptions?.queueLimit ?? 0,
  };
}

function getMySqlAffectedRows(result: unknown): number {
  if (!Array.isArray(result)) return 0;

  const [summary] = result;
  if (typeof summary !== 'object' || summary === null || !('affectedRows' in summary)) {
    return 0;
  }

  return Number(summary.affectedRows ?? 0);
}

function isMySqlDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ER_DUP_ENTRY'
  );
}

async function selectExistingMySqlNonce(
  db: MySql2Database<typeof schema>,
  nonce: string,
): Promise<unknown | undefined> {
  const [existing] = await db
    .select()
    .from(schema.noncesTable)
    .where(
      and(
        eq(schema.noncesTable.nonce, nonce),
        gt(schema.noncesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return existing;
}

function insertMySqlNonce(
  db: MySql2Database<typeof schema>,
  nonce: string,
  expiresAt: Date,
): Promise<unknown> {
  return Promise.resolve(db.insert(schema.noncesTable).values({ nonce, expiresAt }));
}
