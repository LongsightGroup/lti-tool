import {
  createNoopLogger,
  LtiStorageConflictError,
  type LTIClient,
  type LTIDeployment,
  type LTIDynamicRegistrationSession,
  type LTILaunchConfig,
  type LtiLogger,
  type LTISession,
  type LTIStorage,
} from '@longsightgroup/lti-tool';
import { and, eq, gt, type AnyColumn, type SQL } from 'drizzle-orm';

import {
  mapDeploymentRow,
  toDeploymentInsertRow,
  toDeploymentUpdateRow,
  type DeploymentRow,
} from './deploymentRow.js';
import {
  parseRegistrationSessionDataRow,
  parseSessionDataRow,
  projectClient,
  toSessionDataRow,
  type ClientRow,
  type LaunchConfigRow,
  type RegistrationSessionDataRow,
  type SessionDataRow,
} from './storageRows.js';
import {
  createTenantScope,
  type TenantScope,
  type TenantScopedTable,
} from './tenantScope.js';

type QueryResult<Result> = PromiseLike<readonly Result[]> & {
  readonly where: (condition: unknown) => QueryResult<Result>;
  readonly orderBy: (...columns: readonly unknown[]) => QueryResult<Result>;
  readonly limit: (limit: number) => QueryResult<Result>;
  readonly innerJoin: (table: unknown, condition: unknown) => QueryResult<Result>;
};

type SelectBuilder<Result> = {
  readonly from: (table: unknown) => QueryResult<Result>;
};

type InsertBuilder = {
  readonly values: (values: unknown) => PromiseLike<unknown>;
};

type UpdateBuilder = {
  readonly set: (values: unknown) => {
    readonly where: (condition: unknown) => PromiseLike<unknown>;
  };
};

type DeleteBuilder = {
  readonly where: (condition: unknown) => PromiseLike<unknown>;
};

/** Drizzle-compatible query surface shared by SQL adapters. */
export type RelationalDatabase = {
  readonly select: <Result>(selection?: unknown) => SelectBuilder<Result>;
  readonly insert: (table: unknown) => InsertBuilder;
  readonly update: (table: unknown) => UpdateBuilder;
  readonly delete: (table: unknown) => DeleteBuilder;
};

type ClientTable = TenantScopedTable & {
  readonly id: AnyColumn;
  readonly name: AnyColumn;
  readonly iss: AnyColumn;
  readonly clientId: AnyColumn;
  readonly authUrl: AnyColumn;
  readonly tokenUrl: AnyColumn;
  readonly jwksUrl: AnyColumn;
};

type DeploymentTable = TenantScopedTable & {
  readonly id: AnyColumn;
  readonly clientId: AnyColumn;
  readonly deploymentId: AnyColumn;
  readonly name: AnyColumn;
  readonly description: AnyColumn;
};

type ExpiringDataTable = TenantScopedTable & {
  readonly id: AnyColumn;
  readonly data: AnyColumn;
  readonly expiresAt: AnyColumn;
};

type NoncesTable = TenantScopedTable & {
  readonly nonce: AnyColumn;
  readonly expiresAt: AnyColumn;
};

export type RelationalSchema = {
  readonly clientsTable: ClientTable;
  readonly deploymentsTable: DeploymentTable;
  readonly sessionsTable: ExpiringDataTable;
  readonly noncesTable: NoncesTable;
  readonly registrationSessionsTable: ExpiringDataTable;
};

export type RelationalCleanupResult = {
  readonly noncesDeleted: number;
  readonly sessionsDeleted: number;
  readonly registrationSessionsDeleted: number;
};

/** Default nonce TTL for relational storage adapters (15 minutes). */
export const DEFAULT_NONCE_TTL_SECONDS = 60 * 15;

/** Default persisted session TTL for relational storage adapters (24 hours). */
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24;

export type RelationalStorageDialect = {
  readonly name: string;
  readonly sessionTtlSeconds: number;
  readonly nonceTtlSeconds: number;
  readonly executeMutation?: (query: unknown) => Promise<unknown>;
  readonly claimNonce: (nonce: string, expiresAt: number) => Promise<boolean>;
  readonly setRegistrationSession: (
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ) => Promise<void>;
  readonly cleanup: (now: number) => Promise<RelationalCleanupResult>;
  readonly orderClients?: (schema: RelationalSchema) => readonly AnyColumn[];
};

export type RelationalStorageConfig = {
  readonly logger: LtiLogger;
  readonly db: RelationalDatabase;
  readonly schema: RelationalSchema;
  readonly dialect: RelationalStorageDialect;
  /** Binds this storage instance to one tenant for all LTI records. */
  readonly tenantId: string;
};

/**
 * Shared LTI storage implementation for Drizzle-backed relational adapters.
 */
export class RelationalStorage implements LTIStorage {
  private readonly logger: LtiLogger;
  private readonly db: RelationalDatabase;
  private readonly schema: RelationalSchema;
  private readonly dialect: RelationalStorageDialect;
  private readonly tenant: TenantScope;

  constructor(config: RelationalStorageConfig) {
    this.logger = config.logger;
    this.db = config.db;
    this.schema = config.schema;
    this.dialect = config.dialect;
    this.tenant = createTenantScope(config.tenantId);
  }

  async listClients(): Promise<Omit<LTIClient, 'deployments'>[]> {
    this.logger.debug('listing all clients');

    const orderBy = this.dialect.orderClients?.(this.schema);
    const base = this.db
      .select<ClientRow>()
      .from(this.schema.clientsTable)
      .where(this.tenant.condition(this.schema.clientsTable));
    const clients =
      orderBy === undefined || orderBy.length === 0
        ? await base
        : await base.orderBy(...orderBy);

    this.logger.debug({ count: clients.length }, 'clients found');
    return clients.map(projectClient);
  }

  async getClientById(clientId: string): Promise<LTIClient | undefined> {
    this.logger.debug({ clientId }, 'getting client by id');

    const [client] = await this.db
      .select<ClientRow>()
      .from(this.schema.clientsTable)
      .where(
        this.scoped(this.schema.clientsTable, eq(this.schema.clientsTable.id, clientId)),
      )
      .limit(1);

    if (!client) {
      this.logger.warn({ clientId }, 'client not found');
      return undefined;
    }

    return {
      ...projectClient(client),
      deployments: await this.listDeployments(clientId),
    };
  }

  addClient(client: Omit<LTIClient, 'id' | 'deployments'>): Promise<string> {
    this.logger.info({ client }, 'adding client');

    return this.insertUniqueClient(client);
  }

  private async insertUniqueClient(
    client: Omit<LTIClient, 'id' | 'deployments'>,
  ): Promise<string> {
    if (await this.findClientIdByIssAndClientId(client.iss, client.clientId)) {
      throw new LtiStorageConflictError({
        operation: 'addClient',
        message: `Client already exists for issuer ${client.iss} and client ID ${client.clientId}`,
      });
    }

    const clientId = crypto.randomUUID();
    return this.insertClient(clientId, client);
  }

  async updateClient(
    clientId: string,
    client: Partial<Omit<LTIClient, 'id' | 'deployments'>>,
  ): Promise<void> {
    this.logger.info({ clientId, client }, 'updating client');

    if (!(await this.clientExists(clientId))) {
      throw new Error('Client not found');
    }

    await this.executeMutation(
      this.db
        .update(this.schema.clientsTable)
        .set(client)
        .where(
          this.scoped(
            this.schema.clientsTable,
            eq(this.schema.clientsTable.id, clientId),
          ),
        ),
    );

    this.logger.debug({ clientId }, 'client updated');
  }

  async deleteClient(clientId: string): Promise<void> {
    this.logger.info({ clientId }, 'deleting client');

    if (!(await this.clientExists(clientId))) {
      this.logger.warn({ clientId }, 'client not found for deletion');
      return;
    }

    await this.executeMutation(
      this.db
        .delete(this.schema.clientsTable)
        .where(
          this.scoped(
            this.schema.clientsTable,
            eq(this.schema.clientsTable.id, clientId),
          ),
        ),
    );

    this.logger.debug({ clientId }, 'client and all deployments deleted');
  }

  async listDeployments(clientId: string): Promise<LTIDeployment[]> {
    this.logger.debug({ clientId }, 'listing deployments for client');

    const rows = await this.db
      .select<DeploymentRow>()
      .from(this.schema.deploymentsTable)
      .where(
        this.scoped(
          this.schema.deploymentsTable,
          eq(this.schema.deploymentsTable.clientId, clientId),
        ),
      )
      .orderBy(
        this.schema.deploymentsTable.deploymentId,
        this.schema.deploymentsTable.id,
      );
    const deployments = rows.map(mapDeploymentRow);

    this.logger.debug({ clientId, count: deployments.length }, 'deployments found');
    return deployments;
  }

  async getDeploymentByPlatformId(
    clientId: string,
    deploymentId: string,
  ): Promise<LTIDeployment | undefined> {
    this.logger.debug({ clientId, deploymentId }, 'getting deployment by platform id');

    const deployment = await this.getDeploymentByColumns(clientId, {
      column: this.schema.deploymentsTable.deploymentId,
      value: deploymentId,
    });
    if (!deployment) {
      this.logger.warn({ clientId, deploymentId }, 'deployment not found');
      return undefined;
    }

    return deployment;
  }

  addDeployment(
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ): Promise<string> {
    this.logger.info({ clientId, deployment }, 'adding deployment');

    return this.addDeploymentToExistingClient(clientId, deployment);
  }

  private async addDeploymentToExistingClient(
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ): Promise<string> {
    if (!(await this.clientExists(clientId))) {
      throw new Error('Client not found');
    }

    const deploymentInternalId = crypto.randomUUID();
    return this.insertDeployment(deploymentInternalId, clientId, deployment);
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
    await this.executeMutation(
      this.db
        .update(this.schema.deploymentsTable)
        .set(toDeploymentUpdateRow(updated))
        .where(
          this.scoped(
            this.schema.deploymentsTable,
            and(
              eq(this.schema.deploymentsTable.clientId, clientId),
              eq(this.schema.deploymentsTable.id, deploymentId),
            )!,
          ),
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

    await this.executeMutation(
      this.db
        .delete(this.schema.deploymentsTable)
        .where(
          this.scoped(
            this.schema.deploymentsTable,
            and(
              eq(this.schema.deploymentsTable.clientId, clientId),
              eq(this.schema.deploymentsTable.id, deploymentId),
            )!,
          ),
        ),
    );

    this.logger.debug({ clientId, deploymentId }, 'deployment deleted');
  }

  async validateNonce(nonce: string): Promise<boolean> {
    this.logger.debug({ nonce }, 'validating nonce');

    const expiresAt = Date.now() + this.dialect.nonceTtlSeconds * 1000;
    const claimed = await this.dialect.claimNonce(nonce, expiresAt);
    if (!claimed) {
      this.logger.warn({ nonce }, 'nonce already used');
    }

    return claimed;
  }

  async getSession(sessionId: string): Promise<LTISession | undefined> {
    this.logger.debug({ sessionId }, 'getting session');

    const [sessionRecord] = await this.db
      .select<SessionDataRow>()
      .from(this.schema.sessionsTable)
      .where(
        this.scoped(
          this.schema.sessionsTable,
          and(
            eq(this.schema.sessionsTable.id, sessionId),
            gt(this.schema.sessionsTable.expiresAt, Date.now()),
          )!,
        ),
      )
      .limit(1);

    if (!sessionRecord) {
      this.logger.warn({ sessionId }, 'session not found');
      return undefined;
    }

    return parseSessionDataRow(sessionRecord, this.logger);
  }

  async addSession(session: LTISession): Promise<string> {
    this.logger.info({ sessionId: session.id }, 'adding session');

    const expiresAt = Date.now() + this.dialect.sessionTtlSeconds * 1000;
    const row = toSessionDataRow(session);
    await this.executeMutation(
      this.db.insert(this.schema.sessionsTable).values(
        this.tenant.insertValues(this.schema.sessionsTable, {
          id: row.id,
          data: row.data,
          expiresAt,
        }),
      ),
    );

    this.logger.debug({ sessionId: session.id }, 'session added');
    return session.id;
  }

  async getLaunchConfig(
    iss: string,
    clientId: string,
    deploymentId: string,
  ): Promise<LTILaunchConfig | undefined> {
    this.logger.debug({ iss, clientId, deploymentId }, 'getting launch config');

    const row = await this.readLaunchConfigRow(iss, clientId, deploymentId);
    if (!row) {
      this.logger.warn({ iss, clientId, deploymentId }, 'launch config not found');
      return undefined;
    }

    return row;
  }

  /**
   * Relational adapters derive launch config from clients and deployments.
   * Persisted launch config tables are adapter-specific (for example DynamoDB).
   */
  // oxlint-disable-next-line require-await no-unused-vars
  async saveLaunchConfig(launchConfig: LTILaunchConfig): Promise<void> {
    this.logger.debug(
      { launchConfig },
      `${this.dialect.name} launch config derived from clients/deployments`,
    );
  }

  setRegistrationSession(
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ): Promise<void> {
    this.logger.debug({ sessionId }, 'setting registration session');

    return this.dialect.setRegistrationSession(sessionId, session);
  }

  async getRegistrationSession(
    sessionId: string,
  ): Promise<LTIDynamicRegistrationSession | undefined> {
    this.logger.debug({ sessionId }, 'getting registration session');

    const [record] = await this.db
      .select<RegistrationSessionDataRow>()
      .from(this.schema.registrationSessionsTable)
      .where(
        this.scoped(
          this.schema.registrationSessionsTable,
          and(
            eq(this.schema.registrationSessionsTable.id, sessionId),
            gt(this.schema.registrationSessionsTable.expiresAt, Date.now()),
          )!,
        ),
      )
      .limit(1);

    if (!record) {
      this.logger.warn({ sessionId }, 'registration session not found or expired');
      return undefined;
    }

    return parseRegistrationSessionDataRow(record, this.logger);
  }

  async deleteRegistrationSession(sessionId: string): Promise<void> {
    this.logger.debug({ sessionId }, 'deleting registration session');

    await this.executeMutation(
      this.db
        .delete(this.schema.registrationSessionsTable)
        .where(
          this.scoped(
            this.schema.registrationSessionsTable,
            eq(this.schema.registrationSessionsTable.id, sessionId),
          ),
        ),
    );

    this.logger.debug({ sessionId }, 'registration session deleted');
  }

  async cleanup(): Promise<RelationalCleanupResult> {
    this.logger.info('starting cleanup of expired items');

    const result = await this.dialect.cleanup(Date.now());

    this.logger.info(result, 'cleanup completed');
    return result;
  }

  private async clientExists(clientId: string): Promise<boolean> {
    const [client] = await this.db
      .select<{ id: string }>({ id: this.schema.clientsTable.id })
      .from(this.schema.clientsTable)
      .where(
        this.scoped(this.schema.clientsTable, eq(this.schema.clientsTable.id, clientId)),
      )
      .limit(1);

    return client !== undefined;
  }

  private async findClientIdByIssAndClientId(
    iss: string,
    clientId: string,
  ): Promise<string | undefined> {
    const [client] = await this.db
      .select<{ id: string }>({ id: this.schema.clientsTable.id })
      .from(this.schema.clientsTable)
      .where(
        this.scoped(
          this.schema.clientsTable,
          and(
            eq(this.schema.clientsTable.iss, iss),
            eq(this.schema.clientsTable.clientId, clientId),
          )!,
        ),
      )
      .limit(1);

    return client?.id;
  }

  private async readLaunchConfigRow(
    iss: string,
    clientId: string,
    platformDeploymentId: string,
  ): Promise<LTILaunchConfig | undefined> {
    const clientsTable = this.schema.clientsTable;
    const deploymentsTable = this.schema.deploymentsTable;
    const [row] = await this.db
      .select<LaunchConfigRow>({
        iss: clientsTable.iss,
        clientId: clientsTable.clientId,
        authUrl: clientsTable.authUrl,
        tokenUrl: clientsTable.tokenUrl,
        jwksUrl: clientsTable.jwksUrl,
        deploymentId: deploymentsTable.deploymentId,
      })
      .from(clientsTable)
      .innerJoin(deploymentsTable, eq(deploymentsTable.clientId, clientsTable.id))
      .where(
        and(
          this.scoped(clientsTable, eq(clientsTable.iss, iss)),
          eq(clientsTable.clientId, clientId),
          this.scoped(
            deploymentsTable,
            eq(deploymentsTable.deploymentId, platformDeploymentId),
          ),
        ),
      )
      .limit(1);

    return row;
  }

  private async insertClient(
    clientId: string,
    client: Omit<LTIClient, 'id' | 'deployments'>,
  ): Promise<string> {
    await this.executeMutation(
      this.db.insert(this.schema.clientsTable).values(
        this.tenant.insertValues(this.schema.clientsTable, {
          id: clientId,
          ...client,
        }),
      ),
    );
    return clientId;
  }

  private async insertDeployment(
    deploymentInternalId: string,
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ): Promise<string> {
    await this.executeMutation(
      this.db.insert(this.schema.deploymentsTable).values(
        this.tenant.insertValues(this.schema.deploymentsTable, {
          id: deploymentInternalId,
          clientId,
          ...toDeploymentInsertRow(deployment),
        }),
      ),
    );
    return deploymentInternalId;
  }

  private getDeploymentByInternalId(
    clientId: string,
    deploymentInternalId: string,
  ): Promise<LTIDeployment | undefined> {
    return this.getDeploymentByColumns(clientId, {
      column: this.schema.deploymentsTable.id,
      value: deploymentInternalId,
    });
  }

  private async getDeploymentByColumns(
    clientId: string,
    lookup: { readonly column: AnyColumn; readonly value: string },
  ): Promise<LTIDeployment | undefined> {
    const [deployment] = await this.db
      .select<DeploymentRow>()
      .from(this.schema.deploymentsTable)
      .where(
        this.scoped(
          this.schema.deploymentsTable,
          and(
            eq(this.schema.deploymentsTable.clientId, clientId),
            eq(lookup.column, lookup.value),
          )!,
        ),
      )
      .limit(1);

    return deployment === undefined ? undefined : mapDeploymentRow(deployment);
  }

  private executeMutation(query: PromiseLike<unknown>): Promise<unknown> {
    return (this.dialect.executeMutation ?? executePromiseMutation)(query);
  }

  private scoped(table: TenantScopedTable, condition: SQL): SQL {
    return this.tenant.withTenant(table, condition);
  }
}

export function resolveStorageLogger(logger: LtiLogger | undefined): LtiLogger {
  return logger ?? createNoopLogger();
}

export async function executePromiseMutation(query: PromiseLike<unknown>): Promise<void> {
  await Promise.resolve(query);
}

export { createTenantScope } from './tenantScope.js';
export { createD1Dialect } from './d1Dialect.js';
export { createMySqlDialect, getMySqlAffectedRows } from './mysqlDialect.js';
export { createPostgresDialect } from './postgresDialect.js';
