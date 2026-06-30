import {
  isServerlessEnvironment,
  type LTIClient,
  type LTIDeployment,
  type LTIDynamicRegistrationSession,
  type LTILaunchConfig,
  type LTISession,
  type LTIStorage,
} from '@longsightgroup/lti-tool';
import { and, eq, gt, lt } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Logger } from 'pino';
import postgres from 'postgres';

import { mapDeploymentRow, toDeploymentUpdateRow } from '#storage/drizzle-deployment-row';

import { SESSION_CACHE, SESSION_TTL, undefinedSessionValue } from './cacheConfig.js';
import * as schema from './db/schema/index.js';
import type { PostgresStorageConfig } from './interfaces/postgresStorageConfig.js';

/**
 * PostgreSQL implementation of LTI storage interface.
 *
 * Stores clients, deployments, sessions, and nonces in PostgreSQL with LRU caching.
 * Uses Drizzle ORM for type-safe database operations.
 */
export class PostgresStorage implements LTIStorage {
  private logger: Logger;
  private db: PostgresJsDatabase<typeof schema>;
  private sql: postgres.Sql;
  private nonceExpirationSeconds: number;

  constructor(config: PostgresStorageConfig) {
    this.logger =
      config?.logger ??
      ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      } as unknown as Logger);

    this.nonceExpirationSeconds = config.nonceExpirationSeconds ?? 600;

    // Smart connection limit defaults
    const isServerless = isServerlessEnvironment();
    const defaultMax = isServerless ? 1 : 10;
    const max = config.poolOptions?.max ?? defaultMax;

    // Warn if high connection limit in serverless
    if (isServerless && max > 5) {
      this.logger.warn(
        { max, environment: 'serverless' },
        'High connection limit detected in serverless environment. Consider using 1 connection per container to avoid wasting resources.',
      );
    }

    // Create postgres.js connection
    this.sql = postgres(config.connectionUrl, {
      max,
      idle_timeout: config.poolOptions?.idleTimeout ?? 20,
    });

    // Initialize Drizzle
    this.db = drizzle(this.sql, { schema });

    this.logger.debug(
      {
        max,
        isServerless,
        idleTimeout: config.poolOptions?.idleTimeout ?? 20,
      },
      'PostgreSQL connection pool initialized',
    );
  }

  async listClients(): Promise<Omit<LTIClient, 'deployments'>[]> {
    this.logger.debug('listing all clients');

    const clients = await this.db.select().from(schema.clientsTable);

    this.logger.debug({ count: clients.length }, 'clients found');
    return clients;
  }

  async getClientById(clientId: string): Promise<LTIClient | undefined> {
    this.logger.debug({ clientId }, 'getting client by id');

    const [client] = await this.db
      .select()
      .from(schema.clientsTable)
      .where(eq(schema.clientsTable.id, clientId))
      .limit(1);

    if (!client) {
      this.logger.warn({ clientId }, 'client not found');
      return undefined;
    }

    return {
      ...client,
      deployments: await this.listDeployments(clientId),
    };
  }

  async addClient(client: Omit<LTIClient, 'id' | 'deployments'>): Promise<string> {
    this.logger.info({ client }, 'adding client');

    const [inserted] = await this.db
      .insert(schema.clientsTable)
      .values(client)
      .returning({ id: schema.clientsTable.id });

    this.logger.debug({ clientId: inserted.id }, 'client added');
    return inserted.id;
  }

  async updateClient(
    clientId: string,
    client: Partial<Omit<LTIClient, 'id' | 'deployments'>>,
  ): Promise<void> {
    this.logger.info({ clientId, client }, 'updating client');

    const existing = await this.getClientById(clientId);
    if (!existing) throw new Error('Client not found');

    await this.db
      .update(schema.clientsTable)
      .set(client)
      .where(eq(schema.clientsTable.id, clientId));

    this.logger.debug({ clientId }, 'client updated');
  }

  async deleteClient(clientId: string): Promise<void> {
    this.logger.info({ clientId }, 'deleting client');

    const existing = await this.getClientById(clientId);
    if (!existing) {
      this.logger.warn({ clientId }, 'client not found for deletion');
      return;
    }

    // Delete client and all deployments in a transaction
    await this.db.transaction(async (tx) => {
      // Delete all deployments first (child records)
      await tx
        .delete(schema.deploymentsTable)
        .where(eq(schema.deploymentsTable.clientId, clientId));

      this.logger.debug({ clientId }, 'deployments deleted');

      // Then delete the client (parent record)
      await tx.delete(schema.clientsTable).where(eq(schema.clientsTable.id, clientId));

      this.logger.debug({ clientId }, 'client deleted');
    });

    this.logger.debug({ clientId }, 'client and all deployments deleted');
  }

  async listDeployments(clientId: string): Promise<LTIDeployment[]> {
    this.logger.debug({ clientId }, 'listing deployments for client');

    const rows = await this.db
      .select()
      .from(schema.deploymentsTable)
      .where(eq(schema.deploymentsTable.clientId, clientId))
      .orderBy(schema.deploymentsTable.deploymentId, schema.deploymentsTable.id);
    const deployments = rows.map(mapDeploymentRow);

    this.logger.debug({ clientId, count: deployments.length }, 'deployments found');
    return deployments;
  }

  async getDeploymentByPlatformId(
    clientId: string,
    deploymentId: string,
  ): Promise<LTIDeployment | undefined> {
    this.logger.debug({ clientId, deploymentId }, 'getting deployment by platform id');

    const [row] = await this.db
      .select()
      .from(schema.deploymentsTable)
      .where(
        and(
          eq(schema.deploymentsTable.clientId, clientId),
          eq(schema.deploymentsTable.deploymentId, deploymentId),
        ),
      )
      .limit(1);
    const deployment = row === undefined ? undefined : mapDeploymentRow(row);
    if (!deployment) {
      this.logger.warn({ clientId, deploymentId }, 'deployment not found');
      return undefined;
    }

    return deployment;
  }

  async addDeployment(
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ): Promise<string> {
    this.logger.info({ clientId, deployment }, 'adding deployment');

    const [inserted] = await this.db
      .insert(schema.deploymentsTable)
      .values({
        clientId,
        ...deployment,
      })
      .returning({ id: schema.deploymentsTable.id });

    this.logger.debug({ deploymentInternalId: inserted.id }, 'deployment added');
    return inserted.id;
  }

  async updateDeploymentById(
    clientId: string,
    deploymentId: string,
    deployment: Partial<LTIDeployment>,
  ): Promise<void> {
    this.logger.info({ clientId, deploymentId, deployment }, 'updating deployment');

    const existing = await this.getDeploymentByInternalId(clientId, deploymentId);
    if (!existing) throw new Error('Deployment not found');

    const updated = { ...existing, ...deployment };
    await this.db
      .update(schema.deploymentsTable)
      .set(toDeploymentUpdateRow(updated))
      .where(
        and(
          eq(schema.deploymentsTable.clientId, clientId),
          eq(schema.deploymentsTable.id, deploymentId),
        ),
      );

    this.logger.debug({ deploymentId }, 'deployment updated');
  }

  async deleteDeploymentById(clientId: string, deploymentId: string): Promise<void> {
    this.logger.info({ clientId, deploymentId }, 'deleting deployment');

    const existing = await this.getDeploymentByInternalId(clientId, deploymentId);
    if (!existing) {
      this.logger.warn({ clientId, deploymentId }, 'deployment not found for deletion');
      return;
    }

    await this.db
      .delete(schema.deploymentsTable)
      .where(
        and(
          eq(schema.deploymentsTable.clientId, clientId),
          eq(schema.deploymentsTable.id, deploymentId),
        ),
      );

    this.logger.debug({ clientId, deploymentId }, 'deployment deleted');
  }

  async validateNonce(nonce: string): Promise<boolean> {
    this.logger.debug({ nonce }, 'validating nonce');

    // 1. Check if nonce exists and is still valid (not expired)
    const [existing] = await this.db
      .select()
      .from(schema.noncesTable)
      .where(
        and(
          eq(schema.noncesTable.nonce, nonce),
          gt(schema.noncesTable.expiresAt, new Date()), // expiresAt > NOW()
        ),
      )
      .limit(1);

    if (existing) {
      this.logger.warn({ nonce }, 'nonce already used - replay attack detected');
      return false; // Nonce exists and hasn't expired = replay attack
    }

    // 2. Try to insert the nonce
    const expiresAt = new Date(Date.now() + this.nonceExpirationSeconds * 1000);

    try {
      await this.db.insert(schema.noncesTable).values({ nonce, expiresAt });
      return true;
    } catch (error) {
      // Duplicate key error (race condition - another request inserted same nonce)
      // PostgreSQL error code for unique_violation
      if ((error as { code?: string }).code === '23505') {
        this.logger.warn({ nonce }, 'nonce collision detected - replay attack');
        return false;
      }
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<LTISession | undefined> {
    this.logger.debug({ sessionId }, 'getting session');

    // Check cache first
    const cachedSession = SESSION_CACHE.get(sessionId);
    if (cachedSession === undefinedSessionValue) {
      return undefined;
    }
    if (cachedSession) {
      this.logger.debug({ sessionId }, 'session found in cache');
      return cachedSession;
    }

    // Query database
    const [sessionRecord] = await this.db
      .select()
      .from(schema.sessionsTable)
      .where(
        and(
          eq(schema.sessionsTable.id, sessionId),
          gt(schema.sessionsTable.expiresAt, new Date()), // Not expired
        ),
      )
      .limit(1);

    if (!sessionRecord) {
      this.logger.warn({ sessionId }, 'session not found');
      SESSION_CACHE.set(sessionId, undefinedSessionValue);
      return undefined;
    }

    const session: LTISession = {
      id: sessionRecord.id,
      ...sessionRecord.data,
    };

    SESSION_CACHE.set(sessionId, session);
    return session;
  }

  async addSession(session: LTISession): Promise<string> {
    this.logger.debug({ sessionId: session.id }, 'adding session');

    const expiresAt = new Date(Date.now() + SESSION_TTL * 1000);
    const { id, ...data } = session;

    await this.db.insert(schema.sessionsTable).values({
      id,
      data,
      expiresAt,
    });

    // Cache the session
    SESSION_CACHE.set(session.id, session);
    this.logger.debug({ sessionId: session.id }, 'session added');
    return session.id;
  }

  // oxlint-disable-next-line max-lines-per-function
  async getLaunchConfig(
    iss: string,
    clientId: string,
    deploymentId: string,
  ): Promise<LTILaunchConfig | undefined> {
    this.logger.debug({ iss, clientId, deploymentId }, 'getting launch config');

    // Query for client and deployment
    const [result] = await this.db
      .select({
        client: schema.clientsTable,
        deployment: schema.deploymentsTable,
      })
      .from(schema.clientsTable)
      .innerJoin(
        schema.deploymentsTable,
        eq(schema.deploymentsTable.clientId, schema.clientsTable.id),
      )
      .where(
        and(
          eq(schema.clientsTable.iss, iss),
          eq(schema.clientsTable.clientId, clientId),
          eq(schema.deploymentsTable.deploymentId, deploymentId),
        ),
      )
      .limit(1);

    if (!result) {
      // Try with 'default' deployment (for dynamic registration)
      if (deploymentId !== 'default') {
        this.logger.debug({ deploymentId }, 'trying default deployment fallback');
        return this.getLaunchConfig(iss, clientId, 'default');
      }

      this.logger.warn({ iss, clientId, deploymentId }, 'launch config not found');
      return undefined;
    }

    return {
      iss: result.client.iss,
      clientId: result.client.clientId,
      deploymentId: result.deployment.deploymentId,
      authUrl: result.client.authUrl,
      tokenUrl: result.client.tokenUrl,
      jwksUrl: result.client.jwksUrl,
    };
  }

  // oxlint-disable-next-line require-await no-unused-vars
  async saveLaunchConfig(launchConfig: LTILaunchConfig): Promise<void> {
    // PostgreSQL storage doesn't need to persist launch configs separately
    // since they're derived from client + deployment data
    this.logger.debug(
      { launchConfig },
      'launch config would be saved (no-op in PostgreSQL)',
    );
  }

  async setRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    this.logger.debug({ sessionId }, 'setting registration session');

    const expiresAt = new Date(session.expiresAt);

    await this.db.insert(schema.registrationSessionsTable).values({
      id: sessionId,
      data: session,
      expiresAt,
    });

    this.logger.debug({ sessionId }, 'registration session stored');
  }

  async getRegistrationSession(
    sessionId: string,
  ): Promise<LTIDynamicRegistrationSession | undefined> {
    this.logger.debug({ sessionId }, 'getting registration session');

    const [record] = await this.db
      .select()
      .from(schema.registrationSessionsTable)
      .where(
        and(
          eq(schema.registrationSessionsTable.id, sessionId),
          gt(schema.registrationSessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!record) {
      this.logger.warn({ sessionId }, 'registration session not found or expired');
      return undefined;
    }

    return record.data;
  }

  async deleteRegistrationSession(sessionId: string): Promise<void> {
    this.logger.debug({ sessionId }, 'deleting registration session');

    await this.db
      .delete(schema.registrationSessionsTable)
      .where(eq(schema.registrationSessionsTable.id, sessionId));

    this.logger.debug({ sessionId }, 'registration session deleted');
  }

  /**
   * Clean up expired nonces, sessions, and registration sessions.
   * Should be called periodically (e.g., every 30 minutes via EventBridge).
   *
   * @returns Object with counts of deleted items
   */
  async cleanup(): Promise<{
    noncesDeleted: number;
    sessionsDeleted: number;
    registrationSessionsDeleted: number;
  }> {
    this.logger.info('starting cleanup of expired items');

    const now = new Date();

    // Delete expired nonces
    const noncesResult = await this.db
      .delete(schema.noncesTable)
      .where(lt(schema.noncesTable.expiresAt, now))
      .returning({ nonce: schema.noncesTable.nonce });

    // Delete expired sessions
    const sessionsResult = await this.db
      .delete(schema.sessionsTable)
      .where(lt(schema.sessionsTable.expiresAt, now))
      .returning({ id: schema.sessionsTable.id });

    // Delete expired registration sessions
    const regSessionsResult = await this.db
      .delete(schema.registrationSessionsTable)
      .where(lt(schema.registrationSessionsTable.expiresAt, now))
      .returning({ id: schema.registrationSessionsTable.id });

    const result = {
      noncesDeleted: noncesResult.length,
      sessionsDeleted: sessionsResult.length,
      registrationSessionsDeleted: regSessionsResult.length,
    };

    this.logger.info(result, 'cleanup completed');
    return result;
  }

  /**
   * Close the PostgreSQL connection pool.
   * Should be called on graceful server shutdown or after tests.
   * Not required for serverless environments (Lambda manages lifecycle).
   */
  async close(): Promise<void> {
    this.logger.debug('closing PostgreSQL connection pool');
    await this.sql.end();
    this.logger.debug('PostgreSQL connection pool closed');
  }

  private async getDeploymentByInternalId(
    clientId: string,
    deploymentInternalId: string,
  ): Promise<LTIDeployment | undefined> {
    const [deployment] = await this.db
      .select()
      .from(schema.deploymentsTable)
      .where(
        and(
          eq(schema.deploymentsTable.clientId, clientId),
          eq(schema.deploymentsTable.id, deploymentInternalId),
        ),
      )
      .limit(1);

    return deployment === undefined ? undefined : mapDeploymentRow(deployment);
  }
}
