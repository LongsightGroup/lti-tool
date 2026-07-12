import { isServerlessEnvironment, type LtiLogger } from '@longsightgroup/lti-tool';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  RelationalStorage,
  DEFAULT_SESSION_TTL_SECONDS,
  createPostgresDialect,
  type RelationalDatabase,
  resolveStorageLogger,
} from '#storage/relational-storage';

import * as schema from './db/schema/index.js';
import type { PostgresStorageConfig } from './interfaces/postgresStorageConfig.js';

/**
 * PostgreSQL implementation of LTI storage interface.
 */
export class PostgresStorage extends RelationalStorage {
  private readonly adapterLogger: LtiLogger;
  private readonly sql: postgres.Sql;

  constructor(config: PostgresStorageConfig) {
    const logger = resolveStorageLogger(config.logger);
    const connectionOptions = resolveConnectionOptions(config, logger);
    const sql =
      config.sql ??
      postgres(config.connectionUrl, {
        max: connectionOptions.max,
        idle_timeout: connectionOptions.idleTimeout,
      });
    const db = drizzle(sql, { schema });

    super({
      logger,
      // SAFETY: PostgreSQL Drizzle exposes the select/insert/update/delete query surface used by RelationalStorage.
      db: db as unknown as RelationalDatabase,
      schema,
      dialect: createPostgresDialect({
        db,
        schema,
        sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
        tenantId: config.tenantId,
      }),
      tenantId: config.tenantId,
    });

    this.adapterLogger = logger;
    this.sql = sql;

    this.adapterLogger.debug(connectionOptions, 'PostgreSQL connection pool initialized');
  }

  /**
   * Close the PostgreSQL connection pool.
   */
  async close(): Promise<void> {
    this.adapterLogger.debug('closing PostgreSQL connection pool');
    await this.sql.end();
    this.adapterLogger.debug('PostgreSQL connection pool closed');
  }
}

function resolveConnectionOptions(
  config: PostgresStorageConfig,
  logger: LtiLogger,
): {
  readonly idleTimeout: number;
  readonly isServerless: boolean;
  readonly max: number;
} {
  const isServerless = isServerlessEnvironment();
  const defaultMax = isServerless ? 1 : 10;
  const max = config.poolOptions?.max ?? defaultMax;

  if (isServerless && max > 5) {
    logger.warn(
      { max, environment: 'serverless' },
      'High connection limit detected in serverless environment. Consider using 1 connection per container to avoid wasting resources.',
    );
  }

  return {
    idleTimeout: config.poolOptions?.idleTimeout ?? 20,
    isServerless,
    max,
  };
}
