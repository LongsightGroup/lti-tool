import { isServerlessEnvironment } from '@longsightgroup/lti-tool';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import type { Logger } from 'pino';

import {
  RelationalStorage,
  DEFAULT_SESSION_TTL_SECONDS,
  createMySqlDialect,
  type RelationalDatabase,
  resolveStorageLogger,
} from '#storage/relational-storage';

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
      // SAFETY: MySQL Drizzle exposes the select/insert/update/delete query surface used by RelationalStorage.
      db: db as unknown as RelationalDatabase,
      schema,
      dialect: createMySqlDialect({
        db,
        schema,
        sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
      }),
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
      'High connection limit detected in serverless environment. Consider using 1 connection per container to avoid wasting resources.',
    );
  }

  return {
    connectionLimit,
    isServerless,
    queueLimit: config.poolOptions?.queueLimit ?? 0,
  };
}
