// oxlint-disable max-lines-per-function typescript/no-explicit-any
import type { LTIClient, LTIDeployment, LTISession } from '@longsightgroup/lti-tool';
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createMockLTIPayload } from '../../core/test/helpers/fixtures.js';
import { defineStorageConformanceSuite } from '../../core/test/helpers/storageConformance.js';
import * as schema from '../src/db/schema/index.js';
import { MySqlStorage } from '../src/index.js';

let storage: MySqlStorage;
let pool: mysql.Pool;
let db: any;

const testClient: Omit<LTIClient, 'id' | 'deployments'> = {
  name: 'Test Platform',
  iss: 'https://platform.example.com',
  clientId: 'test-client-123',
  authUrl: 'https://platform.example.com/auth',
  tokenUrl: 'https://platform.example.com/token',
  jwksUrl: 'https://platform.example.com/.well-known/jwks',
};

const testDeployment: Omit<LTIDeployment, 'id'> = {
  deploymentId: 'deployment-456',
  name: 'Test Deployment',
  description: 'A test deployment',
};

const testSession: LTISession = {
  id: 'session-789',
  jwtPayload: createMockLTIPayload(),
  user: { id: 'user123', roles: ['Learner'] },
  context: { id: 'context123', label: 'TEST101', title: 'Test Course' },
  platform: {
    issuer: 'https://platform.example.com',
    clientId: 'test-client-123',
    deploymentId: 'deployment-456',
    name: 'Test Platform',
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

beforeAll(() => {
  // env var or local podman / docker container credentials
  const connectionUrl =
    process.env.DATABASE_URL || 'mysql://lti_user:lti_password@localhost:3306/lti_test';
  pool = mysql.createPool({ uri: connectionUrl });
  db = drizzle(pool, { schema, mode: 'default' });

  storage = new MySqlStorage({ connectionUrl });
});

afterAll(async () => {
  // close the drizzle pool
  await storage.close();

  // close the vitest pool
  await pool.end();
});

beforeEach(async () => {
  // Clean all tables between tests
  await db.delete(schema.deploymentsTable);
  await db.delete(schema.clientsTable);
  await db.delete(schema.sessionsTable);
  await db.delete(schema.noncesTable);
  await db.delete(schema.registrationSessionsTable);
});

defineStorageConformanceSuite('MySqlStorage', {
  createStorage: () => storage,
});

describe('MySqlStorage - Client Operations', () => {
  it('should add and retrieve a client', async () => {
    const clientId = await storage.addClient(testClient);
    expect(clientId).toBeTruthy();

    const retrieved = await storage.getClientById(clientId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe(testClient.name);
    expect(retrieved?.iss).toBe(testClient.iss);
    expect(retrieved?.deployments).toEqual([]);
  });

  it('should list all clients', async () => {
    await storage.addClient(testClient);
    await storage.addClient({ ...testClient, clientId: 'another-client' });

    const clients = await storage.listClients();
    expect(clients.length).toBeGreaterThanOrEqual(2);
  });

  it('should delete a client and its deployments', async () => {
    const clientId = await storage.addClient(testClient);
    await storage.addDeployment(clientId, testDeployment);

    await storage.deleteClient(clientId);

    const retrieved = await storage.getClientById(clientId);
    expect(retrieved).toBeUndefined();
    await expect(storage.listDeployments(clientId)).resolves.toEqual([]);
  });
});

describe('MySqlStorage - Session Operations', () => {
  it('should add and retrieve a session', async () => {
    await storage.addSession(testSession);

    const retrieved = await storage.getSession(testSession.id);
    expect(retrieved?.user.id).toBe(testSession.user.id);
  });

  it('should not retrieve expired sessions', async () => {
    await db.insert(schema.sessionsTable).values({
      id: 'expired',
      data: testSession,
      expiresAt: Date.now() - 1000,
    });

    const retrieved = await storage.getSession('expired');
    expect(retrieved).toBeUndefined();
  });
});

describe('MySqlStorage - Nonce Validation', () => {
  it('should validate a new nonce', async () => {
    const result = await storage.validateNonce('unique-nonce');
    expect(result).toBe(true);
  });

  it('should reject duplicate nonce', async () => {
    await storage.validateNonce('dup-nonce');
    const result = await storage.validateNonce('dup-nonce');
    expect(result).toBe(false);
  });

  it('should reject expired nonce still present before cleanup', async () => {
    await db.insert(schema.noncesTable).values({
      nonce: 'expired-nonce',
      expiresAt: Date.now() - 1000,
    });

    const result = await storage.validateNonce('expired-nonce');
    expect(result).toBe(false);
  });
});

describe('MySqlStorage - Launch Config', () => {
  it('should derive launch config from join', async () => {
    const clientId = await storage.addClient(testClient);
    await storage.addDeployment(clientId, testDeployment);

    const config = await storage.getLaunchConfig(
      testClient.iss,
      testClient.clientId,
      testDeployment.deploymentId,
    );

    expect(config?.iss).toBe(testClient.iss);
    expect(config?.authUrl).toBe(testClient.authUrl);
  });

  it('should return undefined when requested deployment is missing', async () => {
    const clientId = await storage.addClient(testClient);
    await storage.addDeployment(clientId, { deploymentId: 'default' });

    const config = await storage.getLaunchConfig(
      testClient.iss,
      testClient.clientId,
      'nonexistent',
    );

    expect(config).toBeUndefined();
  });
});

describe('MySqlStorage - Cleanup', () => {
  it('should delete expired items', async () => {
    await db.insert(schema.noncesTable).values({
      nonce: 'expired-nonce',
      expiresAt: Date.now() - 1000,
    });

    const result = await storage.cleanup();
    expect(result.noncesDeleted).toBe(1);
  });
});
