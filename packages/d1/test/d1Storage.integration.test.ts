// oxlint-disable max-lines-per-function
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LTI_CLAIM_PLATFORM_CONFIGURATION,
  LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
  type LTIClient,
  type LTIDeployment,
  type LTIDynamicRegistrationSession,
  type LTISession,
} from '@longsightgroup/lti-tool';
import { Log, LogLevel, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMockLTIPayload } from '../../core/test/helpers/fixtures.js';
import { defineStorageConformanceSuite } from '../../core/test/helpers/storageConformance.js';
import { D1Storage } from '../src/index.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, '..');

const testClient: Omit<LTIClient, 'id' | 'deployments'> = {
  name: 'Test Platform',
  iss: 'https://platform.example.com',
  clientId: 'oauth-client-id',
  authUrl: 'https://platform.example.com/auth',
  tokenUrl: 'https://platform.example.com/token',
  jwksUrl: 'https://platform.example.com/jwks',
};

const testDeployment: Omit<LTIDeployment, 'id'> = {
  deploymentId: 'platform-deployment-id',
  name: 'Test Deployment',
  description: 'A test deployment',
};

const testSession: LTISession = {
  id: 'session-id',
  jwtPayload: createMockLTIPayload(),
  user: { id: 'user-id', roles: ['Learner'] },
  context: { id: 'context-id', label: 'TEST101', title: 'Test Course' },
  platform: {
    issuer: testClient.iss,
    clientId: testClient.clientId,
    deploymentId: testDeployment.deploymentId,
    name: testClient.name,
  },
  launch: { target: 'https://tool.example.com/launch' },
  customParameters: {},
  isAdmin: false,
  isInstructor: false,
  isStudent: true,
  isAssignmentAndGradesAvailable: false,
  isDeepLinkingAvailable: false,
  isNameAndRolesAvailable: false,
};

let harness: D1StorageHarness;

beforeEach(async () => {
  harness = await D1StorageHarness.create();
});

afterEach(async () => {
  await harness?.dispose();
});

defineStorageConformanceSuite('D1Storage', {
  createStorage: async () => {
    const conformanceHarness = await D1StorageHarness.create();
    return {
      storage: conformanceHarness.storageAdapter,
      cleanup: () => conformanceHarness.dispose(),
    };
  },
});

describe('D1Storage with Miniflare D1', () => {
  describe('client operations', () => {
    it('adds, retrieves, lists, updates, and deletes clients with deployments', async () => {
      const clientInternalId = await harness.storage<string>('addClient', testClient);
      const deploymentInternalId = await harness.storage<string>(
        'addDeployment',
        clientInternalId,
        testDeployment,
      );

      await expect(
        harness.storage('getClientById', clientInternalId),
      ).resolves.toMatchObject({
        id: clientInternalId,
        name: testClient.name,
        deployments: [
          {
            id: deploymentInternalId,
            deploymentId: testDeployment.deploymentId,
          },
        ],
      });
      await expect(harness.storage('listClients')).resolves.toMatchObject([
        { id: clientInternalId, clientId: testClient.clientId },
      ]);

      await harness.storage('updateClient', clientInternalId, {
        name: 'Updated Platform',
      });
      await expect(
        harness.storage('getClientById', clientInternalId),
      ).resolves.toMatchObject({
        id: clientInternalId,
        name: 'Updated Platform',
      });

      await harness.storage('deleteClient', clientInternalId);
      await expect(
        harness.storage('getClientById', clientInternalId),
      ).resolves.toBeNull();
      await expect(harness.storage('listDeployments', clientInternalId)).resolves.toEqual(
        [],
      );
    });

    it('throws when updating a missing client', async () => {
      await expect(
        harness.storage('updateClient', 'missing-client', { name: 'Updated' }),
      ).rejects.toThrow('Client not found');
    });
  });

  describe('session operations', () => {
    it('stores and retrieves active sessions', async () => {
      await harness.storage('addSession', testSession);

      await expect(harness.storage('getSession', testSession.id)).resolves.toMatchObject({
        id: testSession.id,
        user: testSession.user,
      });
    });

    it('does not retrieve expired sessions', async () => {
      await harness.sql(
        'run',
        'INSERT INTO lti_tool_sessions (id, data, expires_at) VALUES (?, ?, ?)',
        [
          'expired-session',
          JSON.stringify({ user: { id: 'expired-user' } }),
          pastTimestamp(),
        ],
      );

      await expect(harness.storage('getSession', 'expired-session')).resolves.toBeNull();
    });
  });

  describe('nonce validation', () => {
    it('returns true once for an unexpired nonce and false on replay', async () => {
      await expect(harness.storage('validateNonce', 'nonce-id')).resolves.toBe(true);
      await expect(harness.storage('validateNonce', 'nonce-id')).resolves.toBe(false);
    });

    it('returns false for expired nonces', async () => {
      await harness.sql(
        'run',
        'INSERT INTO lti_tool_nonces (nonce, expires_at) VALUES (?, ?)',
        ['expired-nonce', pastTimestamp()],
      );

      await expect(harness.storage('validateNonce', 'expired-nonce')).resolves.toBe(
        false,
      );
    });
  });

  describe('launch config', () => {
    it('returns undefined when requested platform deployment is missing', async () => {
      const clientInternalId = await harness.storage<string>('addClient', testClient);
      await harness.storage('addDeployment', clientInternalId, {
        deploymentId: 'default',
      });

      await expect(
        harness.storageAdapter.getLaunchConfig(
          testClient.iss,
          testClient.clientId,
          'missing-deployment',
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('registration sessions', () => {
    it('stores, retrieves, and deletes active registration sessions', async () => {
      const session: LTIDynamicRegistrationSession = {
        openIdConfiguration: {
          issuer: testClient.iss,
          authorization_endpoint: testClient.authUrl,
          registration_endpoint: 'https://platform.example.com/register',
          jwks_uri: testClient.jwksUrl,
          token_endpoint: testClient.tokenUrl,
          token_endpoint_auth_methods_supported: ['private_key_jwt'],
          token_endpoint_auth_signing_alg_values_supported: ['RS256'],
          scopes_supported: [],
          response_types_supported: ['id_token'],
          id_token_signing_alg_values_supported: ['RS256'],
          claims_supported: ['sub'],
          subject_types_supported: ['public'],
          [LTI_CLAIM_PLATFORM_CONFIGURATION]: {
            product_family_code: 'test',
            version: '1',
            messages_supported: [{ type: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST }],
          },
        },
        registrationToken: 'registration-token',
        expiresAt: Date.now() + 60_000,
      };

      await harness.storage('setRegistrationSession', 'registration-session-id', session);
      await expect(
        harness.storage('getRegistrationSession', 'registration-session-id'),
      ).resolves.toEqual(session);

      await harness.storage('deleteRegistrationSession', 'registration-session-id');
      await expect(
        harness.storage('getRegistrationSession', 'registration-session-id'),
      ).resolves.toBeNull();
    });

    it('does not retrieve expired registration sessions', async () => {
      await harness.sql(
        'run',
        'INSERT INTO lti_tool_registration_sessions (id, data, expires_at) VALUES (?, ?, ?)',
        [
          'expired-registration-session',
          JSON.stringify({ state: 'expired' }),
          pastTimestamp(),
        ],
      );

      await expect(
        harness.storage('getRegistrationSession', 'expired-registration-session'),
      ).resolves.toBeNull();
    });
  });

  describe('cleanup', () => {
    it('deletes expired nonces, sessions, and registration sessions', async () => {
      await harness.sql(
        'run',
        'INSERT INTO lti_tool_nonces (nonce, expires_at) VALUES (?, ?), (?, ?)',
        ['expired-nonce', pastTimestamp(), 'active-nonce', futureTimestamp()],
      );
      await harness.sql(
        'run',
        'INSERT INTO lti_tool_sessions (id, data, expires_at) VALUES (?, ?, ?), (?, ?, ?)',
        [
          'expired-session',
          '{}',
          pastTimestamp(),
          'active-session',
          '{}',
          futureTimestamp(),
        ],
      );
      await harness.sql(
        'run',
        'INSERT INTO lti_tool_registration_sessions (id, data, expires_at) VALUES (?, ?, ?), (?, ?, ?)',
        [
          'expired-registration',
          '{}',
          pastTimestamp(),
          'active-registration',
          '{}',
          futureTimestamp(),
        ],
      );

      await expect(harness.storage('cleanup')).resolves.toEqual({
        noncesDeleted: 1,
        sessionsDeleted: 1,
        registrationSessionsDeleted: 1,
      });
      await expect(
        harness.sql('first', 'SELECT COUNT(*) AS count FROM lti_tool_nonces'),
      ).resolves.toEqual({ count: 1 });
      await expect(
        harness.sql('first', 'SELECT COUNT(*) AS count FROM lti_tool_sessions'),
      ).resolves.toEqual({ count: 1 });
      await expect(
        harness.sql(
          'first',
          'SELECT COUNT(*) AS count FROM lti_tool_registration_sessions',
        ),
      ).resolves.toEqual({ count: 1 });
    });
  });
});

class D1StorageHarness {
  private constructor(
    private mf: Miniflare,
    private database: Awaited<ReturnType<Miniflare['getD1Database']>>,
    readonly storageAdapter: D1Storage,
  ) {}

  static async create(): Promise<D1StorageHarness> {
    const mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      compatibilityDate: '2026-05-07',
      d1Databases: { DB: 'test-db' },
      log: new Log(LogLevel.WARN),
    });
    const database = await mf.getD1Database('DB');
    const harness = new D1StorageHarness(mf, database, new D1Storage({ database }));
    try {
      await harness.applyMigrations();
      return harness;
    } catch (error) {
      await harness.dispose();
      throw error;
    }
  }

  async storage<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    const storageMethod = (
      this.storageAdapter as unknown as Record<
        string,
        (...methodArgs: unknown[]) => Promise<unknown>
      >
    )[method];

    const result = await storageMethod.apply(this.storageAdapter, reviveArgs(args));
    return (result ?? null) as T;
  }

  sql<T = unknown>(
    mode: 'exec' | 'first' | 'run',
    sql: string,
    params: unknown[] = [],
  ): Promise<T> {
    if (mode === 'exec') {
      return this.database.exec(sql) as Promise<T>;
    }

    const statement = this.database.prepare(sql).bind(...params);
    if (mode === 'first') {
      return statement.first() as Promise<T>;
    }
    return statement.run() as Promise<T>;
  }

  async dispose(): Promise<void> {
    await this.mf.dispose();
  }

  private async applyMigrations(): Promise<void> {
    const migrationsDirectory = resolve(packageRoot, 'drizzle');
    const migrationFileNames = (await readdir(migrationsDirectory))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();

    for (const fileName of migrationFileNames) {
      const migration = await readFile(join(migrationsDirectory, fileName), 'utf8');
      const statements = migration
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await this.sql('run', statement);
      }
    }
  }
}

function reviveArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (
      typeof arg === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(arg)
    ) {
      return new Date(arg);
    }
    return arg;
  });
}

function futureTimestamp(): number {
  return Date.now() + 60_000;
}

function pastTimestamp(): number {
  return Date.now() - 60_000;
}
