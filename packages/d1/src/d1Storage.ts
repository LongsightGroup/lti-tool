import type {
  LTIClient,
  LTIDeployment,
  LTIDynamicRegistrationSession,
  LTILaunchConfig,
  LTISession,
  LTIStorage,
} from '@lti-tool/core';
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import type { Logger } from 'pino';

import { SESSION_TTL } from './cacheConfig.js';
import * as schema from './db/schema/index.js';
import type { D1StorageConfig } from './interfaces/d1StorageConfig.js';

type DeploymentRow = typeof schema.deploymentsTable.$inferSelect;

/**
 * Cloudflare D1 implementation of LTI storage interface.
 *
 * Stores clients, deployments, sessions, and nonces in D1.
 * Uses Drizzle ORM for type-safe database operations.
 * NOTE: No in-process cache: Workers isolates can't share state,
 * and stale launch configs after admin updates would not be evictable
 * across the edge fleet. D1 handles read caching itself.
 */
export class D1Storage implements LTIStorage {
  private logger: Logger;
  private db: DrizzleD1Database<typeof schema>;

  constructor(config: D1StorageConfig) {
    this.logger =
      config.logger ??
      ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      } as unknown as Logger);

    this.db = drizzle(config.database, { schema });
  }

  async listClients(): Promise<Omit<LTIClient, 'deployments'>[]> {
    this.logger.debug('listing all clients');

    const clients = await this.db
      .select()
      .from(schema.clientsTable)
      .orderBy(schema.clientsTable.name, schema.clientsTable.id);

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
    const clientId = crypto.randomUUID();
    this.logger.info({ clientId, client }, 'adding client');

    await this.db
      .insert(schema.clientsTable)
      .values({
        id: clientId,
        ...client,
      })
      .run();

    return clientId;
  }

  async updateClient(
    clientId: string,
    client: Partial<Omit<LTIClient, 'id' | 'deployments'>>,
  ): Promise<void> {
    this.logger.info({ clientId, client }, 'updating client');

    const existing = await this.getClientById(clientId);
    if (!existing) throw new Error('Client not found');

    const updated = {
      ...existing,
      ...client,
    };

    const { deployments: _clientDeployments, ...clientWithoutDeployments } = updated;

    await this.db
      .update(schema.clientsTable)
      .set(clientWithoutDeployments)
      .where(eq(schema.clientsTable.id, clientId))
      .run();
  }

  async deleteClient(clientId: string): Promise<void> {
    this.logger.info({ clientId }, 'deleting client');

    await this.db
      .delete(schema.deploymentsTable)
      .where(eq(schema.deploymentsTable.clientId, clientId))
      .run();
    await this.db
      .delete(schema.clientsTable)
      .where(eq(schema.clientsTable.id, clientId))
      .run();
  }

  async listDeployments(clientId: string): Promise<LTIDeployment[]> {
    this.logger.debug({ clientId }, 'listing deployments for client');

    const deployments = await this.db
      .select()
      .from(schema.deploymentsTable)
      .where(eq(schema.deploymentsTable.clientId, clientId))
      .orderBy(schema.deploymentsTable.deploymentId, schema.deploymentsTable.id);

    return deployments.map(mapDeploymentRow);
  }

  async getDeployment(
    clientId: string,
    deploymentId: string,
  ): Promise<LTIDeployment | undefined> {
    this.logger.debug({ clientId, deploymentId }, 'getting deployment by platform id');

    const [deployment] = await this.db
      .select()
      .from(schema.deploymentsTable)
      .where(
        and(
          eq(schema.deploymentsTable.clientId, clientId),
          eq(schema.deploymentsTable.deploymentId, deploymentId),
        ),
      )
      .limit(1);

    return deployment ? mapDeploymentRow(deployment) : undefined;
  }

  async addDeployment(
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ): Promise<string> {
    const deploymentInternalId = crypto.randomUUID();
    this.logger.info({ clientId, deploymentInternalId, deployment }, 'adding deployment');

    await this.db
      .insert(schema.deploymentsTable)
      .values({
        id: deploymentInternalId,
        clientId,
        deploymentId: deployment.deploymentId,
        name: deployment.name ?? null,
        description: deployment.description ?? null,
      })
      .run();

    return deploymentInternalId;
  }

  async updateDeployment(
    clientId: string,
    deploymentInternalId: string,
    deployment: Partial<LTIDeployment>,
  ): Promise<void> {
    this.logger.info(
      { clientId, deploymentInternalId, deployment },
      'updating deployment',
    );

    const existing = await this.getDeploymentByInternalId(clientId, deploymentInternalId);
    if (!existing) throw new Error('Deployment not found');

    const updated = {
      ...existing,
      ...deployment,
    };

    await this.db
      .update(schema.deploymentsTable)
      .set({
        deploymentId: updated.deploymentId,
        name: updated.name ?? null,
        description: updated.description ?? null,
      })
      .where(
        and(
          eq(schema.deploymentsTable.clientId, clientId),
          eq(schema.deploymentsTable.id, deploymentInternalId),
        ),
      )
      .run();
  }

  async deleteDeployment(clientId: string, deploymentInternalId: string): Promise<void> {
    this.logger.info({ clientId, deploymentInternalId }, 'deleting deployment');

    await this.db
      .delete(schema.deploymentsTable)
      .where(
        and(
          eq(schema.deploymentsTable.clientId, clientId),
          eq(schema.deploymentsTable.id, deploymentInternalId),
        ),
      )
      .run();
  }

  async getSession(sessionId: string): Promise<LTISession | undefined> {
    this.logger.debug({ sessionId }, 'getting session');

    const [session] = await this.db
      .select()
      .from(schema.sessionsTable)
      .where(
        and(
          eq(schema.sessionsTable.id, sessionId),
          gt(schema.sessionsTable.expiresAt, new Date().toISOString()),
        ),
      )
      .limit(1);

    if (!session) return undefined;

    return {
      id: session.id,
      ...session.data,
    };
  }

  async addSession(session: LTISession): Promise<string> {
    this.logger.debug({ sessionId: session.id }, 'adding session');

    const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString();
    const { id, ...data } = session;

    await this.db.insert(schema.sessionsTable).values({ id, data, expiresAt }).run();

    return id;
  }

  async storeNonce(nonce: string, expiresAt: Date): Promise<void> {
    this.logger.debug({ nonce, expiresAt }, 'storing nonce');

    await this.db
      .insert(schema.noncesTable)
      .values({
        nonce,
        expiresAt: expiresAt.toISOString(),
        usedAt: null,
      })
      .onConflictDoUpdate({
        target: schema.noncesTable.nonce,
        set: {
          expiresAt: expiresAt.toISOString(),
          usedAt: null,
        },
      })
      .run();
  }

  async validateNonce(nonce: string): Promise<boolean> {
    this.logger.debug({ nonce }, 'validating nonce');

    const now = new Date().toISOString();
    const result = await this.db
      .update(schema.noncesTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.noncesTable.nonce, nonce),
          isNull(schema.noncesTable.usedAt),
          gt(schema.noncesTable.expiresAt, now),
        ),
      )
      .run();

    return getChangedRows(result) === 1;
  }

  async getLaunchConfig(
    iss: string,
    clientId: string,
    platformDeploymentId: string,
  ): Promise<LTILaunchConfig | undefined> {
    this.logger.debug({ iss, clientId, platformDeploymentId }, 'getting launch config');

    const row = await this.readLaunchConfigRow(iss, clientId, platformDeploymentId);
    if (row) return row;

    if (platformDeploymentId !== 'default') {
      return this.getLaunchConfig(iss, clientId, 'default');
    }

    this.logger.warn({ iss, clientId, platformDeploymentId }, 'launch config not found');
    return undefined;
  }

  // oxlint-disable-next-line require-await no-unused-vars
  async saveLaunchConfig(launchConfig: LTILaunchConfig): Promise<void> {
    this.logger.debug({ launchConfig }, 'launch config derived from clients/deployments');
  }

  async setRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    this.logger.debug({ sessionId }, 'setting registration session');

    await this.db
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

  async getRegistrationSession(
    sessionId: string,
  ): Promise<LTIDynamicRegistrationSession | undefined> {
    this.logger.debug({ sessionId }, 'getting registration session');

    const [session] = await this.db
      .select()
      .from(schema.registrationSessionsTable)
      .where(
        and(
          eq(schema.registrationSessionsTable.id, sessionId),
          gt(schema.registrationSessionsTable.expiresAt, new Date().toISOString()),
        ),
      )
      .limit(1);

    return session?.data;
  }

  async deleteRegistrationSession(sessionId: string): Promise<void> {
    this.logger.debug({ sessionId }, 'deleting registration session');

    await this.db
      .delete(schema.registrationSessionsTable)
      .where(eq(schema.registrationSessionsTable.id, sessionId))
      .run();
  }

  async cleanup(): Promise<{
    noncesDeleted: number;
    sessionsDeleted: number;
    registrationSessionsDeleted: number;
  }> {
    this.logger.info('starting cleanup of expired items');

    const now = new Date().toISOString();
    const nonces = await this.db
      .delete(schema.noncesTable)
      .where(lte(schema.noncesTable.expiresAt, now))
      .run();
    const sessions = await this.db
      .delete(schema.sessionsTable)
      .where(lte(schema.sessionsTable.expiresAt, now))
      .run();
    const registrationSessions = await this.db
      .delete(schema.registrationSessionsTable)
      .where(lte(schema.registrationSessionsTable.expiresAt, now))
      .run();

    return {
      noncesDeleted: getChangedRows(nonces),
      sessionsDeleted: getChangedRows(sessions),
      registrationSessionsDeleted: getChangedRows(registrationSessions),
    };
  }

  private async readLaunchConfigRow(
    iss: string,
    clientId: string,
    platformDeploymentId: string,
  ): Promise<LTILaunchConfig | undefined> {
    const [row] = await this.db
      .select({
        iss: schema.clientsTable.iss,
        clientId: schema.clientsTable.clientId,
        authUrl: schema.clientsTable.authUrl,
        tokenUrl: schema.clientsTable.tokenUrl,
        jwksUrl: schema.clientsTable.jwksUrl,
        deploymentId: schema.deploymentsTable.deploymentId,
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
          eq(schema.deploymentsTable.deploymentId, platformDeploymentId),
        ),
      )
      .limit(1);

    return row;
  }

  private async getDeploymentByInternalId(
    clientId: string,
    deploymentInternalId: string,
  ): Promise<LTIDeployment | undefined> {
    this.logger.debug(
      { clientId, deploymentInternalId },
      'getting deployment by internal id',
    );

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

    return deployment ? mapDeploymentRow(deployment) : undefined;
  }
}

function mapDeploymentRow(row: DeploymentRow): LTIDeployment {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    name: row.name ?? undefined,
    description: row.description ?? undefined,
  };
}

function getChangedRows(result: { meta?: { changes?: number } }): number {
  return result.meta?.changes ?? 0;
}
