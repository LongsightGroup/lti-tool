import { calculateJwkThumbprint, SignJWT, jwtVerify } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import {
  importLtiToolKeyPairFromJwk,
  LtiToolKeyPairImportError,
  type LtiToolPrivateJwkInput,
} from '../src/index.js';

const generatePrivateJwk = async (kid?: string): Promise<LtiToolPrivateJwkInput> => {
  const generatedKey = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  if (!('privateKey' in generatedKey)) {
    throw new Error('Expected an RSA key pair');
  }

  const privateJwk = await crypto.subtle.exportKey('jwk', generatedKey.privateKey);
  return kid === undefined ? privateJwk : { ...privateJwk, kid };
};

describe('LTI tool key pair helpers', () => {
  it('imports an RSA private JWK JSON string into a signing key pair', async () => {
    const privateJwk = await generatePrivateJwk('tool-key-1');

    const result = await importLtiToolKeyPairFromJwk(JSON.stringify(privateJwk));

    expect(result.keyId).toBe('tool-key-1');
    expect(result.keyPair.privateKey.type).toBe('private');
    expect(result.keyPair.publicKey.type).toBe('public');
    expect(result.publicJwk).toMatchObject({
      kty: 'RSA',
      n: privateJwk.n,
      e: privateJwk.e,
      alg: 'RS256',
      use: 'sig',
      kid: 'tool-key-1',
    });
    expect(result.jwks).toEqual({ keys: [result.publicJwk] });
    expect(result.publicJwk).not.toHaveProperty('d');

    const jwt = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'RS256', kid: result.keyId })
      .sign(result.keyPair.privateKey);
    const verified = await jwtVerify(jwt, result.keyPair.publicKey);

    expect(verified.payload.sub).toBe('user-1');
    expect(verified.protectedHeader.kid).toBe('tool-key-1');
  });

  it('imports an RSA private JWK object and trims the key ID', async () => {
    const privateJwk = await generatePrivateJwk('  tool-key-2  ');

    const result = await importLtiToolKeyPairFromJwk(privateJwk);

    expect(result.keyId).toBe('tool-key-2');
    expect(result.publicJwk.kid).toBe('tool-key-2');
  });

  it('derives the key ID from the public JWK thumbprint when kid is absent', async () => {
    const privateJwk = await generatePrivateJwk(undefined);
    const expectedKid = await calculateJwkThumbprint(
      { kty: 'RSA', n: privateJwk.n, e: privateJwk.e },
      'sha256',
    );

    const result = await importLtiToolKeyPairFromJwk(privateJwk);

    expect(result.keyId).toBe(expectedKid);
    expect(result.publicJwk.kid).toBe(expectedKid);
    expect(result.jwks.keys).toEqual([result.publicJwk]);
  });

  it('rejects invalid JWK JSON without echoing the input', async () => {
    await expect(importLtiToolKeyPairFromJwk('{not-json')).rejects.toMatchObject({
      name: 'LtiToolKeyPairImportError',
      code: 'invalid_private_jwk_json',
      message: 'LTI tool private JWK must be valid JSON',
    });
  });

  it('rejects non-RSA or incomplete private JWKs', async () => {
    await expect(
      importLtiToolKeyPairFromJwk({ kty: 'RSA', n: 'n', e: 'e', d: 'd' }),
    ).rejects.toMatchObject({
      name: 'LtiToolKeyPairImportError',
      code: 'invalid_private_jwk',
      message:
        'LTI tool private JWK must be an RSA private JWK with private key parameters',
    });
  });

  it('wraps WebCrypto import failures in a typed error', async () => {
    const privateJwk = await generatePrivateJwk('bad-key');
    const importKeySpy = vi
      .spyOn(crypto.subtle, 'importKey')
      .mockRejectedValue(new DOMException('Rejected by WebCrypto'));

    try {
      await expect(importLtiToolKeyPairFromJwk(privateJwk)).rejects.toBeInstanceOf(
        LtiToolKeyPairImportError,
      );

      await expect(importLtiToolKeyPairFromJwk(privateJwk)).rejects.toMatchObject({
        code: 'key_import_failed',
        message: 'LTI tool private JWK could not be imported as an RS256 key pair',
      });
    } finally {
      importKeySpy.mockRestore();
    }
  });
});
