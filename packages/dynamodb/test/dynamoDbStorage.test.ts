// oxlint-disable max-lines-per-function
import {
  type AttributeValue,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { LTIClient, LTISession } from '@longsightgroup/lti-tool';
import type { BaseLogger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defineStorageConformanceSuite } from '../../core/test/helpers/storageConformance.js';
import { LAUNCH_CONFIG_CACHE } from '../src/cacheConfig.js';
import { DynamoDbStorage } from '../src/index.js';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', async (importOriginal) => {
  const actual = (await importOriginal()) as object;

  return {
    ...actual,
    DynamoDBClient: vi.fn(function () {
      return {
        send: mockSend,
      };
    }),
  };
});

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'info',
  msgPrefix: '',
} as BaseLogger;
const mockClient: LTIClient = {
  id: 'client-uuid-123',
  iss: 'https://platform.example.com',
  clientId: 'client123',
  authUrl: 'https://platform.example.com/auth',
  tokenUrl: 'https://platform.example.com/token',
  jwksUrl: 'https://platform.example.com/.well-known/jwks',
  deployments: [
    {
      id: 'deployment',
      deploymentId: 'deployment1',
    },
  ],
  name: 'Test Client',
};

const mockLaunchConfig = {
  iss: 'https://platform.example.com',
  clientId: 'client123',
  deploymentId: 'deployment1',
  authUrl: 'https://platform.example.com/auth',
  tokenUrl: 'https://platform.example.com/token',
  jwksUrl: 'https://platform.example.com/.well-known/jwks',
};

const mockSession: LTISession = {
  id: 'session123',
  jwtPayload: {},
  user: { id: 'user123', roles: [] },
  context: { id: 'context123', label: 'TEST', title: 'Test' },
  platform: {
    issuer: 'https://platform.example.com',
    clientId: 'client123',
    deploymentId: 'deployment1',
    name: 'Test',
  },
  launch: { target: 'https://tool.example.com/v1p3/debug' },
  customParameters: {},
  isAdmin: false,
  isInstructor: false,
  isStudent: false,
  isAssignmentAndGradesAvailable: false,
  isDeepLinkingAvailable: false,
  isNameAndRolesAvailable: false,
};

describe('DynamoDbStorage', () => {
  let storage: DynamoDbStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    LAUNCH_CONFIG_CACHE.clear();

    // Reset mock implementation to ensure clean state
    mockSend.mockReset();

    storage = new DynamoDbStorage({
      controlPlaneTable: 'controlPlane',
      dataPlaneTable: 'dataPlane',
      launchConfigTable: 'launchConfigs',
      // oxlint-disable no-explicit-anyq
      logger: mockLogger as any,
    });
  });

  defineStorageConformanceSuite('DynamoDbStorage', {
    createStorage: () => {
      mockSend.mockImplementation(createDynamoConformanceMock());
      return storage;
    },
  });

  describe('getDeploymentByPlatformId', () => {
    it('queries the platform deployment lookup index directly', async () => {
      mockSend.mockResolvedValue({
        ...dynamoOk(),
        Items: [
          marshall({
            pk: 'C#client-uuid-123',
            sk: 'D#deployment',
            gsi2pk: 'C#client-uuid-123',
            gsi2sk: 'PD#deployment1',
            type: 'Deployment',
            id: 'deployment',
            deploymentId: 'deployment1',
          }),
        ],
      });

      const result = await storage.getDeploymentByPlatformId(
        'client-uuid-123',
        'deployment1',
      );

      expect(result).toMatchObject({
        id: 'deployment',
        deploymentId: 'deployment1',
      });
      expect(commandInput(mockSend.mock.calls[0]?.[0]).IndexName).toBe('GSI2');
    });
  });

  describe('getClientById', () => {
    it('fetches from DynamoDB when not cached', async () => {
      mockSend.mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        Items: [
          // Client record
          marshall({
            pk: 'C#client-uuid-123',
            sk: '#',
            type: 'Client',
            ...mockClient,
          }),
          // Deployment record
          marshall({
            pk: 'C#client-uuid-123',
            sk: 'D#deployment',
            type: 'Deployment',
            id: 'deployment',
            deploymentId: 'deployment1',
          }),
        ],
      });

      const result = await storage.getClientById('client-uuid-123');

      expect(result).toEqual(expect.objectContaining(mockClient));
      expect(mockSend).toHaveBeenCalledOnce();
    });
  });

  describe('updateClient', () => {
    it('updates existing client', async () => {
      // Mock getClientById call (validates client exists)
      mockSend.mockResolvedValueOnce({
        $metadata: { httpStatusCode: 200 },
        Items: [
          marshall({
            pk: 'C#client-uuid-123',
            sk: '#',
            type: 'Client',
            ...mockClient,
          }),
          marshall({
            pk: 'C#client-uuid-123',
            sk: 'D#deployment',
            type: 'Deployment',
            id: 'deployment',
            deploymentId: 'deployment1',
          }),
        ],
      });

      // Mock the PutItem update operation
      mockSend.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });

      // Spy on updateClientLaunchConfigs to avoid the complex mocking
      const updateLaunchConfigsSpy = vi
        .spyOn(storage as any, 'updateClientLaunchConfigs')
        .mockResolvedValue(undefined);

      await storage.updateClient('client-uuid-123', {
        name: 'Updated',
      });

      expect(mockSend).toHaveBeenCalledTimes(2); // getClientById + PutItem
      expect(updateLaunchConfigsSpy).toHaveBeenCalledWith('client-uuid-123');

      updateLaunchConfigsSpy.mockRestore();
    });
  });

  describe('validateNonce', () => {
    it('returns false for existing nonce (replay attack)', async () => {
      const conditionalError = new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
      });

      mockSend.mockRejectedValue(conditionalError);

      const result = await storage.validateNonce('used-nonce');

      expect(result).toBe(false);
    });

    it('returns true and stores new nonce', async () => {
      mockSend
        .mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 }, Item: undefined })
        .mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });

      const result = await storage.validateNonce('new-nonce');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1); // single conditional input
    });
  });

  describe('getSession', () => {
    it('fetches from DynamoDB', async () => {
      mockSend.mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        Item: marshall(mockSession),
      });

      const result = await storage.getSession('session123');

      expect(result).toEqual(expect.objectContaining({ id: 'session123' }));
    });

    it('returns undefined when DynamoDB has no session item', async () => {
      mockSend.mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        Item: undefined,
      });

      const result = await storage.getSession('missing-session');

      expect(result).toBeUndefined();
      expect(mockSend).toHaveBeenCalledOnce();
    });
  });

  describe('addSession', () => {
    it('stores session with TTL', async () => {
      mockSend.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });

      await storage.addSession(mockSession);

      expect(mockSend).toHaveBeenCalledOnce();
    });
  });

  describe('getLaunchConfig', () => {
    it('returns cached launch config', async () => {
      // Pre-populate cache
      LAUNCH_CONFIG_CACHE.set(
        'https://platform.example.com#client123#deployment1',
        mockLaunchConfig,
      );

      const result = await storage.getLaunchConfig(
        'https://platform.example.com',
        'client123',
        'deployment1',
      );

      expect(result).toEqual(mockLaunchConfig);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('fetches from DynamoDB when not cached and caches result', async () => {
      mockSend.mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        Item: marshall(mockLaunchConfig),
      });

      const result = await storage.getLaunchConfig(
        'https://platform.example.com',
        'client123',
        'deployment1',
      );

      expect(result).toEqual(mockLaunchConfig);
      expect(mockSend).toHaveBeenCalledOnce();

      // Verify it was cached
      const cacheKey = 'https://platform.example.com#client123#deployment1';
      expect(LAUNCH_CONFIG_CACHE.get(cacheKey)).toEqual(mockLaunchConfig);
    });
  });
});

function createDynamoConformanceMock(): (command: unknown) => unknown {
  const clients = new Map<string, Record<string, unknown>>();
  const deployments = new Map<string, Map<string, Record<string, unknown>>>();
  const nonces = new Set<string>();
  const registrationSessions = new Map<string, Record<string, unknown>>();

  return (command: unknown) => {
    const input = commandInput(command);
    const commandName = commandConstructorName(command);

    if (input.Item !== undefined) {
      const item = unmarshall(input.Item);
      if (input.TableName === 'controlPlane' && item.type === 'Client') {
        clients.set(String(item.id), item);
        return dynamoOk();
      }
      if (input.TableName === 'controlPlane' && item.type === 'Deployment') {
        const clientDeployments = deployments.get(String(item.pk)) ?? new Map();
        clientDeployments.set(String(item.id), item);
        deployments.set(String(item.pk), clientDeployments);
        return dynamoOk();
      }
      if (input.TableName === 'dataPlane') {
        const pk = String(item.pk ?? '');
        if (pk.startsWith('DYNREG#')) {
          registrationSessions.set(pk, item);
          return dynamoOk();
        }

        const nonce = String(item.nonce);
        if (nonces.has(nonce)) {
          throw new ConditionalCheckFailedException({
            message: 'The conditional request failed',
            $metadata: {},
          });
        }
        nonces.add(nonce);
        return dynamoOk();
      }
      if (input.TableName === 'launchConfigs') return dynamoOk();
    }

    if (input.KeyConditionExpression !== undefined) {
      if (input.TableName === 'controlPlane') {
        if (input.IndexName === 'GSI2') {
          const expressionValues = input.ExpressionAttributeValues ?? {};
          const pk = attributeString(expressionValues[':gsi2pk']);
          const gsi2sk = attributeString(expressionValues[':gsi2sk']);
          const deployment = [...(deployments.get(pk)?.values() ?? [])].find(
            (item) => item.gsi2sk === gsi2sk,
          );

          return {
            ...dynamoOk(),
            Items: deployment === undefined ? [] : [marshall(deployment)],
          };
        }

        const expressionValues = input.ExpressionAttributeValues ?? {};
        const pk = attributeString(expressionValues[':pk']);
        const clientId = pk.replace(/^C#/, '');
        const client = clients.get(clientId);
        const clientDeployments = [...(deployments.get(pk)?.values() ?? [])];
        if (input.KeyConditionExpression?.includes('begins_with')) {
          return {
            ...dynamoOk(),
            Items: clientDeployments.map((item) => marshall(item)),
          };
        }
        const items = client === undefined ? [] : [client, ...clientDeployments];
        return { ...dynamoOk(), Items: items.map((item) => marshall(item)) };
      }
      if (input.TableName === 'launchConfigs') return { ...dynamoOk(), Items: [] };
    }

    if (input.Key !== undefined && commandName === 'GetItemCommand') {
      const key = unmarshall(input.Key);
      if (input.TableName === 'controlPlane') {
        const deployment = deployments
          .get(String(key.pk))
          ?.get(String(key.sk).replace(/^D#/, ''));
        return deployment === undefined
          ? dynamoOk()
          : { ...dynamoOk(), Item: marshall(deployment) };
      }
      if (input.TableName === 'dataPlane') {
        const session = registrationSessions.get(String(key.pk));
        return session === undefined
          ? dynamoOk()
          : { ...dynamoOk(), Item: marshall(session) };
      }
      if (input.TableName === 'launchConfigs') return dynamoOk();
    }

    if (input.Key !== undefined && commandName === 'DeleteItemCommand') {
      const key = unmarshall(input.Key);
      if (input.TableName === 'controlPlane') {
        deployments.get(String(key.pk))?.delete(String(key.sk).replace(/^D#/, ''));
      }
      return dynamoOk();
    }

    return dynamoOk();
  };
}

type DynamoCommandInput = {
  readonly TableName?: string;
  readonly Item?: Record<string, AttributeValue>;
  readonly Key?: Record<string, AttributeValue>;
  readonly ExpressionAttributeValues?: Record<string, AttributeValue>;
  readonly KeyConditionExpression?: string;
  readonly IndexName?: string;
};

function commandInput(command: unknown): DynamoCommandInput {
  return (command as { readonly input: DynamoCommandInput }).input;
}

function commandConstructorName(command: unknown): string {
  return (command as { readonly constructor: { readonly name: string } }).constructor
    .name;
}

function attributeString(attribute: unknown): string {
  return String((attribute as { readonly S?: string }).S);
}

function dynamoOk(): { readonly $metadata: { readonly httpStatusCode: number } } {
  return { $metadata: { httpStatusCode: 200 } };
}
