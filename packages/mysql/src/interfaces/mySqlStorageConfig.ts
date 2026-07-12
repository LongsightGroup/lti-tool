import type { LtiLogger } from '@longsightgroup/lti-tool';
import type mysql from 'mysql2/promise';

export interface MySqlStorageConfig {
  tenantId: string;
  logger?: LtiLogger;
  /**
   * MySQL connection URL in format: mysql://user:password@host:port/database
   * Compatible with DATABASE_URL environment variable used by most ORMs
   */
  connectionUrl: string;
  /**
   * Optional pre-created mysql2 pool (used by integration test harnesses).
   */
  pool?: mysql.Pool;
  /**
   * Optional mysql2 pool configuration
   */
  poolOptions?: {
    /**
     * Maximum number of connections in the pool.
     * Defaults to 1 in serverless environments, 10 otherwise.
     *
     * Recommended values:
     * - Serverless (Lambda, Cloud Functions): 1
     * - Low traffic servers: 5-10
     * - Medium traffic servers: 10-20
     * - High traffic servers: 20-50
     */
    connectionLimit?: number;
    queueLimit?: number;
  };
  /**
   * Nonce expiration time in seconds (defaults to 600 = 10 minutes)
   */
  nonceExpirationSeconds?: number;
}
