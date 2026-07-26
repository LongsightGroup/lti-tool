import { describe, expect, it, vi } from 'vitest';

import type { LtiLogFields, LtiLogger } from '../src/interfaces/ltiLogger.js';
import type { LTIStorage } from '../src/interfaces/ltiStorage.js';
import { LTITool } from '../src/ltiTool.js';

const structuralLogger: LtiLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createTestStorage(): LTIStorage {
  return {
    listClients: vi.fn(),
    getClientById: vi.fn(),
    addClient: vi.fn(),
    updateClient: vi.fn(),
    deleteClient: vi.fn(),
    listDeployments: vi.fn(),
    getDeploymentByPlatformId: vi.fn(),
    addDeployment: vi.fn(),
    updateDeploymentById: vi.fn(),
    deleteDeploymentById: vi.fn(),
    getSession: vi.fn(),
    addSession: vi.fn(),
    validateNonce: vi.fn(),
    getLaunchConfig: vi.fn(),
    saveLaunchConfig: vi.fn(),
    consumeRegistrationSession: vi.fn(),
    setRegistrationSession: vi.fn(),
  };
}

describe('LtiLogger', () => {
  it('accepts structural loggers in LTITool config', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );

    expect(
      () =>
        new LTITool({
          stateSecret: new Uint8Array(32),
          keyPair,
          storage: createTestStorage(),
          logger: structuralLogger,
        }),
    ).not.toThrow();
  });

  it('supports structured field and message calls', () => {
    const events: Array<readonly [LtiLogFields | string, string | undefined]> = [];
    const recordLog = (
      fieldsOrMessage: LtiLogFields | string,
      message?: string,
    ): void => {
      events.push([fieldsOrMessage, message]);
    };
    const logger: LtiLogger = {
      debug: recordLog,
      info: recordLog,
      warn: recordLog,
      error: recordLog,
    };

    logger.info('ready');
    logger.warn({ route: '/lti/login' }, 'login warning');

    expect(events).toEqual([
      ['ready', undefined],
      [{ route: '/lti/login' }, 'login warning'],
    ]);
  });
});
