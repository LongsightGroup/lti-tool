// oxlint-disable max-lines-per-function
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  createNoopLogger,
  type LTIClient,
  type LTISession,
} from '@longsightgroup/lti-tool';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testSession } from '#test-harness/fixtures';

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

const mockSession: LTISession = testSession({
  id: 'session123',
  platform: {
    issuer: 'https://platform.example.com',
    clientId: 'client123',
    deploymentId: 'deployment1',
    name: 'Test',
  },
});

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
      tenantId: 'test-tenant',
      logger: createNoopLogger(),
    });
  });

  describe('getDeploymentByPlatformId', () => {
    it('queries the platform deployment lookup index directly', async () => {
      mockSend.mockResolvedValue({
        ...dynamoOk(),
        Items: [
          marshall({
            pk: 'T#test-tenant#C#client-uuid-123',
            sk: 'D#deployment',
            gsi2pk: 'T#test-tenant#C#client-uuid-123',
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
    it('scopes control-plane queries to the configured tenant', async () => {
      mockSend.mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        Items: [],
      });

      await storage.getClientById('client-uuid-123');

      const input = commandInput(mockSend.mock.calls[0]?.[0]) as {
        readonly ExpressionAttributeValues?: Record<string, { S: string }>;
      };
      expect(unmarshall(input.ExpressionAttributeValues ?? {})[':pk']).toBe(
        'T#test-tenant#C#client-uuid-123',
      );
    });

    it('fetches from DynamoDB when not cached', async () => {
      mockSend.mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        Items: [
          // Client record
          marshall({
            pk: 'T#test-tenant#C#client-uuid-123',
            sk: '#',
            type: 'Client',
            ...mockClient,
          }),
          // Deployment record
          marshall({
            pk: 'T#test-tenant#C#client-uuid-123',
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
            pk: 'T#test-tenant#C#client-uuid-123',
            sk: '#',
            type: 'Client',
            ...mockClient,
          }),
          marshall({
            pk: 'T#test-tenant#C#client-uuid-123',
            sk: 'D#deployment',
            type: 'Deployment',
            id: 'deployment',
            deploymentId: 'deployment1',
          }),
        ],
      });

      // Mock the PutItem update operation and launch config sync query.
      mockSend.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });
      mockSend.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 }, Items: [] });

      await storage.updateClient('client-uuid-123', {
        name: 'Updated',
      });

      expect(mockSend).toHaveBeenCalledTimes(3);
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
        'T#test-tenant#https://platform.example.com#client123#deployment1',
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
      const cacheKey = 'T#test-tenant#https://platform.example.com#client123#deployment1';
      expect(LAUNCH_CONFIG_CACHE.get(cacheKey)).toEqual(mockLaunchConfig);
    });
  });
});

function commandInput(command: unknown): {
  readonly IndexName?: string;
} {
  return (command as { readonly input: { readonly IndexName?: string } }).input;
}

function dynamoOk(): { readonly $metadata: { readonly httpStatusCode: number } } {
  return { $metadata: { httpStatusCode: 200 } };
}
