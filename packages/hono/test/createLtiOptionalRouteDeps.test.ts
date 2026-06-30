import { LTITool } from '@longsightgroup/lti-tool';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MemoryStorage } from '../../memory/src/index.js';
import { createLtiOptionalRouteDeps } from '../src/ltiRoutes/createLtiOptionalRouteDeps.js';

describe('createLtiOptionalRouteDeps', () => {
  let keyPair: CryptoKeyPair;
  let ltiTool: LTITool;

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
  });

  beforeEach(() => {
    ltiTool = new LTITool({
      keyPair,
      stateSecret: new TextEncoder().encode('test-state-secret-exactly32bytes'),
      storage: new MemoryStorage(),
    });
  });

  it('binds optional route deps from LTITool', async () => {
    const deps = createLtiOptionalRouteDeps({ ltiTool });

    await expect(deps.deepLink.getSession('missing-session')).resolves.toBeUndefined();
    expect(deps.initiateDynamicRegistration.initiateDynamicRegistration).toBeTypeOf(
      'function',
    );
    expect(deps.completeDynamicRegistration.completeDynamicRegistration).toBeTypeOf(
      'function',
    );
    expect(deps.deepLink.logger).toBe(deps.initiateDynamicRegistration.logger);
    expect(deps.initiateDynamicRegistration.logger).toBe(
      deps.completeDynamicRegistration.logger,
    );
  });
});
