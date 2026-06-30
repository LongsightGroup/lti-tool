import type {
  LTIClient,
  LTIDeployment,
  LTIDynamicRegistrationSession,
  LTILaunchConfig,
  LTISession,
  LTIStorage,
} from '@longsightgroup/lti-tool';
import { and, eq, gt, type AnyColumn } from 'drizzle-orm';
import type { Logger } from 'pino';

import {
  mapDeploymentRow,
  toDeploymentUpdateRow,
  type DeploymentRow,
} from '#storage/drizzle-deployment-row';

type ClientRow = Omit<LTIClient, 'deployments'>;

type SessionRow = {
  readonly id: string;
  readonly data: Omit<LTISession, 'id'>;
};

type RegistrationSessionRow = {
  readonly data: LTIDynamicRegistrationSession;
};

type LaunchConfigRow = LTILaunchConfig;

export type MutationQuery = PromiseLike<unknown>;

type QueryResult<Result> = PromiseLike<readonly Result[]> & {
  readonly where: (condition: unknown) => QueryResult<Result>;
  readonly orderBy: (...columns: readonly AnyColumn[]) => QueryResult<Result>;
  readonly limit: (limit: number) => QueryResult<Result>;
  readonly innerJoin: (table: unknown, condition: unknown) => QueryResult<Result>;
};

type SelectBuilder<Result> = {
  readonly from: (table: unknown) => QueryResult<Result>;
};

type InsertBuilder = {
  readonly values: (values: unknown) => MutationQuery;
};

type UpdateBuilder = {
  readonly set: (values: unknown) => {
    readonly where: (condition: unknown) => MutationQuery;
  };
};

type DeleteBuilder = {
  readonly where: (condition: unknown) => MutationQuery;
};

export type RelationalDatabase = {
  readonly select: <Result>(selection?: unknown) => SelectBuilder<Result>;
  readonly insert: (table: unknown) => InsertBuilder;
  readonly update: (table: unknown) => UpdateBuilder;
  readonly delete: (table: unknown) => DeleteBuilder;
};

type ClientTable = {
  readonly id: AnyColumn;
  readonly name: AnyColumn;
  readonly iss: AnyColumn;
  readonly clientId: AnyColumn;
  readonly authUrl: AnyColumn;
  readonly tokenUrl: AnyColumn;
  readonly jwksUrl: AnyColumn;
};

type DeploymentTable = {
  readonly id: AnyColumn;
  readonly clientId: AnyColumn;
  readonly deploymentId: AnyColumn;
  readonly name: AnyColumn;
  readonly description: AnyColumn;
};

type ExpiringDataTable = {
  readonly id: AnyColumn;
  readonly data: AnyColumn;
  readonly expiresAt: AnyColumn;
};

type NoncesTable = {
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

export type RelationalStorageDialect = {
  readonly name: string;
  readonly sessionTtlSeconds: number;
  readonly insertClient: (
    client: Omit<LTIClient, 'id' | 'deployments'>,
  ) => Promise<string>;
  readonly insertDeployment: (
    clientId: string,
    deployment: Omit<LTIDeployment, 'id'>,
  ) => Promise<string>;
  readonly executeMutation?: (query: unknown) => Promise<unknown>;
  readonly deleteClient: (clientId: string) => Promise<void>;
  readonly requireExistingClientBeforeDelete?: boolean;
  readonly insertSession: (
    session: LTISession,
    expiresAt: Date | string,
  ) => Promise<void>;
  readonly validateNonce: (nonce: string) => Promise<boolean>;
  readonly serializeDate: (date: Date) => Date | string;
  readonly setRegistrationSession: (
    sessionId: string,
    session: LTIDynamicRegistrationSession,
  ) => Promise<void>;
  readonly cleanup: (now: Date) => Promise<RelationalCleanupResult>;
  readonly orderClients?: (schema: RelationalSchema) => readonly AnyColumn[];
};

export type RelationalStorageConfig = {
  readonly logger: Logger;
  readonly db: RelationalDatabase;
  readonly schema: RelationalSchema;
  readonly dialect: RelationalStorageDialect;
};

/**
 * Shared LTI storage implementation for Drizzle-backed relational adapters.
 */
export class RelationalStorage implements LTIStorage {
  private readonly logger: Logger;
  private readonly db: RelationalDatabase;
  private readonly schema: RelationalSchema;
  private readonly dialect: RelationalStorageDialect;

  constructor(config: RelationalStorageConfig) {
    this.logger = config.logger;
    this.db = config.db;
    this.schema = config.schema;
    this.dialect = config.dialect;
  }

  async listClients(): Promise<Omit<LTIClient, 'deployments'>[]> {
    this.logger.debug('listing all clients');

    const query = this.db.select<ClientRow>().from(this.schema.clientsTable);
    const orderBy = this.dialect.orderClients?.(this.schema);
    const clients =
      orderBy === undefined || orderBy.length === 0
        ? await query
        : await query.orderBy(...orderBy);

    this.logger.debug({ count: clients.length }, 'clients found');
    return clients.map(projectClient);
  }

  async getClientById(clientId: string): Promise<LTIClient | undefined> {
    this.logger.debug({ clientId }, 'getting client by id');

    const [client] = await this.db
      .select<ClientRow>()
      .from(this.schema.clientsTable)
      .where(eq(this.schema.clientsTable.id, clientId))
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

    return this.dialect.insertClient(client);
  }

  async updateClient(
    clientId: string,
    client: Partial<Omit<LTIClient, 'id' | 'deployments'>>,
  ): Promise<void> {
    this.logger.info({ clientId, client }, 'updating client');

    const existing = await this.getClientById(clientId);
    if (!existing) throw new Error('Client not found');

    await this.executeMutation(
      this.db
        .update(this.schema.clientsTable)
        .set(client)
        .where(eq(this.schema.clientsTable.id, clientId)),
    );

    this.logger.debug({ clientId }, 'client updated');
  }

  async deleteClient(clientId: string): Promise<void> {
    this.logger.info({ clientId }, 'deleting client');

    if (this.dialect.requireExistingClientBeforeDelete) {
      const existing = await this.getClientById(clientId);
      if (!existing) {
        this.logger.warn({ clientId }, 'client not found for deletion');
        return;
      }
    }

    await this.dialect.deleteClient(clientId);

    this.logger.debug({ clientId }, 'client and all deployments deleted');
  }

  async listDeployments(clientId: string): Promise<LTIDeployment[]> {
    this.logger.debug({ clientId }, 'listing deployments for client');

    const rows = await this.db
      .select<DeploymentRow>()
      .from(this.schema.deploymentsTable)
      .where(eq(this.schema.deploymentsTable.clientId, clientId))
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

    return this.dialect.insertDeployment(clientId, deployment);
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
          and(
            eq(this.schema.deploymentsTable.clientId, clientId),
            eq(this.schema.deploymentsTable.id, deploymentId),
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
          and(
            eq(this.schema.deploymentsTable.clientId, clientId),
            eq(this.schema.deploymentsTable.id, deploymentId),
          ),
        ),
    );

    this.logger.debug({ clientId, deploymentId }, 'deployment deleted');
  }

  validateNonce(nonce: string): Promise<boolean> {
    this.logger.debug({ nonce }, 'validating nonce');

    return this.dialect.validateNonce(nonce);
  }

  async getSession(sessionId: string): Promise<LTISession | undefined> {
    this.logger.debug({ sessionId }, 'getting session');

    const [sessionRecord] = await this.db
      .select<SessionRow>()
      .from(this.schema.sessionsTable)
      .where(
        and(
          eq(this.schema.sessionsTable.id, sessionId),
          gt(this.schema.sessionsTable.expiresAt, this.dialect.serializeDate(new Date())),
        ),
      )
      .limit(1);

    if (!sessionRecord) {
      this.logger.warn({ sessionId }, 'session not found');
      return undefined;
    }

    return {
      id: sessionRecord.id,
      ...sessionRecord.data,
    };
  }

  async addSession(session: LTISession): Promise<string> {
    this.logger.debug({ sessionId: session.id }, 'adding session');

    const expiresAt = this.dialect.serializeDate(
      new Date(Date.now() + this.dialect.sessionTtlSeconds * 1000),
    );
    await this.dialect.insertSession(session, expiresAt);

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
    if (row) return row;

    if (deploymentId !== 'default') {
      this.logger.debug({ deploymentId }, 'trying default deployment fallback');
      return this.getLaunchConfig(iss, clientId, 'default');
    }

    this.logger.warn({ iss, clientId, deploymentId }, 'launch config not found');
    return undefined;
  }

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
      .select<RegistrationSessionRow>()
      .from(this.schema.registrationSessionsTable)
      .where(
        and(
          eq(this.schema.registrationSessionsTable.id, sessionId),
          gt(
            this.schema.registrationSessionsTable.expiresAt,
            this.dialect.serializeDate(new Date()),
          ),
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

    await this.executeMutation(
      this.db
        .delete(this.schema.registrationSessionsTable)
        .where(eq(this.schema.registrationSessionsTable.id, sessionId)),
    );

    this.logger.debug({ sessionId }, 'registration session deleted');
  }

  async cleanup(): Promise<RelationalCleanupResult> {
    this.logger.info('starting cleanup of expired items');

    const result = await this.dialect.cleanup(new Date());

    this.logger.info(result, 'cleanup completed');
    return result;
  }

  private async readLaunchConfigRow(
    iss: string,
    clientId: string,
    platformDeploymentId: string,
  ): Promise<LTILaunchConfig | undefined> {
    const [row] = await this.db
      .select<LaunchConfigRow>({
        iss: this.schema.clientsTable.iss,
        clientId: this.schema.clientsTable.clientId,
        authUrl: this.schema.clientsTable.authUrl,
        tokenUrl: this.schema.clientsTable.tokenUrl,
        jwksUrl: this.schema.clientsTable.jwksUrl,
        deploymentId: this.schema.deploymentsTable.deploymentId,
      })
      .from(this.schema.clientsTable)
      .innerJoin(
        this.schema.deploymentsTable,
        eq(this.schema.deploymentsTable.clientId, this.schema.clientsTable.id),
      )
      .where(
        and(
          eq(this.schema.clientsTable.iss, iss),
          eq(this.schema.clientsTable.clientId, clientId),
          eq(this.schema.deploymentsTable.deploymentId, platformDeploymentId),
        ),
      )
      .limit(1);

    return row;
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
        and(
          eq(this.schema.deploymentsTable.clientId, clientId),
          eq(lookup.column, lookup.value),
        ),
      )
      .limit(1);

    return deployment === undefined ? undefined : mapDeploymentRow(deployment);
  }

  private executeMutation(query: MutationQuery): Promise<unknown> {
    return (this.dialect.executeMutation ?? executePromiseMutation)(query);
  }
}

export function resolveStorageLogger(logger: Logger | undefined): Logger {
  return (
    logger ??
    ({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Logger)
  );
}

export async function executePromiseMutation(query: MutationQuery): Promise<void> {
  await Promise.resolve(query);
}

export type SelectThenInsertNonceConfig<TDb> = {
  readonly nonceTtlSeconds: number;
  readonly isDuplicateKeyError: (error: unknown) => boolean;
  readonly selectExistingNonce: (db: TDb, nonce: string) => Promise<unknown | undefined>;
  readonly insertNonce: (db: TDb, nonce: string, expiresAt: Date) => Promise<unknown>;
};

export async function validateNonceSelectThenInsert<TDb>(
  db: TDb,
  nonce: string,
  config: SelectThenInsertNonceConfig<TDb>,
): Promise<boolean> {
  const existing = await config.selectExistingNonce(db, nonce);
  if (existing) return false;

  const expiresAt = new Date(Date.now() + config.nonceTtlSeconds * 1000);
  try {
    await config.insertNonce(db, nonce, expiresAt);
    return true;
  } catch (error: unknown) {
    if (config.isDuplicateKeyError(error)) return false;
    throw error;
  }
}

function projectClient(client: ClientRow): Omit<LTIClient, 'deployments'> {
  return {
    id: client.id,
    name: client.name,
    iss: client.iss,
    clientId: client.clientId,
    authUrl: client.authUrl,
    tokenUrl: client.tokenUrl,
    jwksUrl: client.jwksUrl,
  };
}
