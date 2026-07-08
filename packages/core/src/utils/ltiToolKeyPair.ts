import { calculateJwkThumbprint } from 'jose';

import type { JWKS } from '../interfaces/jwks.js';

const RS256_IMPORT_ALGORITHM = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
} as const;

export type LtiToolKeyPairImportErrorCode =
  | 'invalid_private_jwk_json'
  | 'invalid_private_jwk'
  | 'key_import_failed';

export interface LtiToolKeyMaterial {
  /** WebCrypto key pair suitable for LTI JWT signing and JWKS publication. */
  readonly keyPair: CryptoKeyPair;
  /** Key identifier read from the private JWK's kid field or derived from its public thumbprint. */
  readonly keyId: string;
  /** Public JWK matching the imported signing key. */
  readonly publicJwk: LtiToolPublicJwk;
  /** JWKS containing the public JWK matching the imported signing key. */
  readonly jwks: JWKS;
}

export type LtiToolPrivateJwkInput = JsonWebKey & {
  /** Key identifier used in JWT headers and JWKS entries. */
  kid?: string;
};

export type LtiToolPublicJwk = JsonWebKey & {
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
  readonly alg: 'RS256';
  readonly use: 'sig';
  readonly kid: string;
  readonly [key: string]: unknown;
};

/**
 * Error thrown when private JWK key material cannot be parsed or imported.
 */
export class LtiToolKeyPairImportError extends Error {
  readonly code: LtiToolKeyPairImportErrorCode;

  constructor(code: LtiToolKeyPairImportErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LtiToolKeyPairImportError';
    this.code = code;
  }
}

type RsaPrivateJwk = JsonWebKey & {
  kty: 'RSA';
  n: string;
  e: string;
  d: string;
  p: string;
  q: string;
  dp: string;
  dq: string;
  qi: string;
  kid: string;
};

/**
 * Imports an RSA private JWK into the CryptoKeyPair shape expected by LTIConfig.
 *
 * The returned keyId is the trimmed JWK kid value, or a public JWK thumbprint
 * when the input does not include kid. Pass it to LTIConfig.security.keyId so
 * JWT headers and JWKS entries use the same key ID.
 *
 * @param input - Private RSA JWK object or JSON string containing the JWK
 * @returns Imported key pair plus the preserved key ID
 * @throws {LtiToolKeyPairImportError} When the JWK is invalid or cannot be imported
 */
export async function importLtiToolKeyPairFromJwk(
  input: string | LtiToolPrivateJwkInput,
): Promise<LtiToolKeyMaterial> {
  const privateJwk = await parseRsaPrivateJwk(input);
  const publicJwk = toPublicJwk(privateJwk);
  const importPublicJwk: LtiToolPrivateJwkInput = {
    kty: privateJwk.kty,
    n: privateJwk.n,
    e: privateJwk.e,
    alg: 'RS256',
    use: 'sig',
    key_ops: ['verify'],
    ext: true,
    kid: privateJwk.kid,
  };

  try {
    const [privateKey, publicKey] = await Promise.all([
      crypto.subtle.importKey(
        'jwk',
        {
          ...privateJwk,
          alg: 'RS256',
          use: 'sig',
          key_ops: ['sign'],
          ext: false,
        },
        RS256_IMPORT_ALGORITHM,
        false,
        ['sign'],
      ),
      crypto.subtle.importKey('jwk', importPublicJwk, RS256_IMPORT_ALGORITHM, true, [
        'verify',
      ]),
    ]);

    return {
      keyPair: { privateKey, publicKey },
      keyId: privateJwk.kid,
      publicJwk,
      jwks: { keys: [publicJwk] },
    };
  } catch (error) {
    throw new LtiToolKeyPairImportError(
      'key_import_failed',
      'LTI tool private JWK could not be imported as an RS256 key pair',
      error,
    );
  }
}

async function parseRsaPrivateJwk(
  input: string | LtiToolPrivateJwkInput,
): Promise<RsaPrivateJwk> {
  const parsed = typeof input === 'string' ? parsePrivateJwkJson(input) : input;

  if (!isRecord(parsed)) {
    throw invalidPrivateJwk();
  }

  const kid = readNonEmptyString(parsed, 'kid');
  const n = readNonEmptyString(parsed, 'n');
  const e = readNonEmptyString(parsed, 'e');
  const d = readNonEmptyString(parsed, 'd');
  const p = readNonEmptyString(parsed, 'p');
  const q = readNonEmptyString(parsed, 'q');
  const dp = readNonEmptyString(parsed, 'dp');
  const dq = readNonEmptyString(parsed, 'dq');
  const qi = readNonEmptyString(parsed, 'qi');

  if (
    parsed.kty !== 'RSA' ||
    n === undefined ||
    e === undefined ||
    d === undefined ||
    p === undefined ||
    q === undefined ||
    dp === undefined ||
    dq === undefined ||
    qi === undefined
  ) {
    throw invalidPrivateJwk();
  }

  const resolvedKid =
    kid ?? (await calculateJwkThumbprint({ kty: 'RSA', n, e }, 'sha256'));

  return {
    ...parsed,
    kty: 'RSA',
    n,
    e,
    d,
    p,
    q,
    dp,
    dq,
    qi,
    kid: resolvedKid,
  };
}

function toPublicJwk(privateJwk: RsaPrivateJwk): LtiToolPublicJwk {
  return {
    kty: privateJwk.kty,
    n: privateJwk.n,
    e: privateJwk.e,
    alg: 'RS256',
    use: 'sig',
    kid: privateJwk.kid,
  };
}

function parsePrivateJwkJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new LtiToolKeyPairImportError(
      'invalid_private_jwk_json',
      'LTI tool private JWK must be valid JSON',
      error,
    );
  }
}

function invalidPrivateJwk(): LtiToolKeyPairImportError {
  return new LtiToolKeyPairImportError(
    'invalid_private_jwk',
    'LTI tool private JWK must be an RSA private JWK with private key parameters',
  );
}

function readNonEmptyString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  return typeof field === 'string' && field.trim() ? field.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
