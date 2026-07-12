import { drizzle } from 'drizzle-orm/d1';

import {
  RelationalStorage,
  DEFAULT_SESSION_TTL_SECONDS,
  createD1Dialect,
  type RelationalDatabase,
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
      dialect: createD1Dialect({
        db,
        schema,
        sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
        tenantId: config.tenantId,
      }),
      tenantId: config.tenantId,
    });
  }
}
