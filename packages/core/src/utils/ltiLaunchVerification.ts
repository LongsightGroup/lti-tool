import { createRemoteJWKSet, decodeJwt, jwtVerify, type RemoteJWKSetOptions } from 'jose';

import { LTI_CLAIM_DEPLOYMENT_ID, LTI_CLAIM_TARGET_LINK_URI } from '../constants.js';
import type { LTILaunchConfig } from '../interfaces/ltiLaunchConfig.js';
import type { LTIStorage } from '../interfaces/ltiStorage.js';
import {
  HandleLoginParamsSchema,
  LTI13JwtPayloadSchema,
  VerifyLaunchParamsSchema,
  type LTI13JwtPayload,
} from '../schemas/index.js';

import { formatError } from './errorFormatting.js';
import { resolveLaunchConfig } from './launchConfigValidation.js';

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;
export type LtiLaunchJwksCache = Map<string, RemoteJwks>;

/** Remote JWKS fetch and cache bounds used while verifying launch JWTs. */
export interface LtiRemoteJwksOptions {
  /** Timeout in milliseconds for a remote JWKS HTTP request. */
  readonly timeoutDuration?: RemoteJWKSetOptions['timeoutDuration'];
  /** Duration in milliseconds before another successful JWKS fetch may occur. */
  readonly cooldownDuration?: RemoteJWKSetOptions['cooldownDuration'];
  /** Maximum age in milliseconds for the cached JWKS before refresh. */
  readonly cacheMaxAge?: RemoteJWKSetOptions['cacheMaxAge'];
}

/** Issuer, client, and deployment identity shared by launch verification events. */
export interface LtiLaunchIdentity {
  readonly issuer: string;
  readonly clientId: string;
  readonly deploymentId: string;
}

/** Event emitted after a launch verification result is known. */
export interface LtiLaunchVerifiedEvent extends LtiLaunchIdentity {
  readonly type: 'launch_verified';
}

/** Event emitted after launch verification returns a structured failure. */
export interface LtiLaunchVerificationFailedEvent {
  readonly type: 'launch_verification_failed';
  readonly code: LtiLaunchVerificationErrorCode;
}

/** Event emitted when a cached JWKS misses a key ID and verification refetches once. */
export interface LtiLaunchJwksKidMissRefetchEvent extends LtiLaunchIdentity {
  readonly type: 'jwks_kid_miss_refetch';
  readonly jwksUrl: string;
}

/** Safe launch verification event for audit, metrics, or tracing observers. */
export type LtiLaunchVerificationEvent =
  | LtiLaunchVerifiedEvent
  | LtiLaunchVerificationFailedEvent
  | LtiLaunchJwksKidMissRefetchEvent;

/**
 * Synchronous observer for launch verification events.
 *
 * In edge runtimes, schedule asynchronous audit writes in the framework layer
 * with the platform's background-work primitive, such as Cloudflare
 * `ctx.waitUntil`.
 */
export type LtiLaunchVerificationEventObserver = (
  event: LtiLaunchVerificationEvent,
) => void;

interface VerifyLtiLaunchInput {
  idToken: string;
  state: string;
  stateSecret: Uint8Array;
  storage: LTIStorage;
  trustedAudiences?: string[];
  jwksCache: LtiLaunchJwksCache;
  remoteJwks?: LtiRemoteJwksOptions;
  onVerificationEvent?: LtiLaunchVerificationEventObserver;
}

export type LtiLaunchVerificationErrorCode =
  | 'invalid_audience'
  | 'invalid_launch_parameters'
  | 'invalid_payload'
  | 'issuer_mismatch'
  | 'jwt_decode_failed'
  | 'jwt_verification_failed'
  | 'launch_client_not_found'
  | 'launch_config_invalid'
  | 'launch_config_lookup_failed'
  | 'launch_config_missing_jwks_endpoint'
  | 'launch_config_missing_token_endpoint'
  | 'launch_config_not_found'
  | 'launch_deployment_not_found'
  | 'missing_deployment_id'
  | 'missing_issuer'
  | 'nonce_mismatch'
  | 'nonce_replay'
  | 'state_verification_failed'
  | 'target_link_uri_mismatch'
  | 'unknown_error'
  | 'untrusted_audience'
  | 'verified_launch_authorization_failed';

export class LtiLaunchVerificationError extends Error {
  constructor(
    public readonly code: LtiLaunchVerificationErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LtiLaunchVerificationError';
  }
}

export interface LtiVerifiedLaunch {
  payload: LTI13JwtPayload;
  issuer: string;
  clientId: string;
  deploymentId: string;
  targetLinkUri: string;
  launchConfig: LTILaunchConfig;
}

export type LtiAuthorizedLaunch<TAuthorization> = LtiVerifiedLaunch & {
  authorization: TAuthorization;
};

export type LtiVerifiedLaunchAuthorizationResult<TAuthorization> =
  | {
      success: true;
      data: TAuthorization;
    }
  | {
      success: false;
      code: string;
      message?: string;
      cause?: unknown;
    };

export type LtiVerifiedLaunchAuthorizer<TAuthorization> = (
  launch: LtiVerifiedLaunch,
) =>
  | LtiVerifiedLaunchAuthorizationResult<TAuthorization>
  | Promise<LtiVerifiedLaunchAuthorizationResult<TAuthorization>>;

export interface LtiVerifyLaunchOptions<TAuthorization = never> {
  authorizeVerifiedLaunch?: LtiVerifiedLaunchAuthorizer<TAuthorization>;
  onVerificationEvent?: LtiLaunchVerificationEventObserver;
}

export type LtiAuthorizeVerifiedLaunchOptions<TAuthorization> =
  LtiVerifyLaunchOptions<TAuthorization> & {
    readonly authorizeVerifiedLaunch: LtiVerifiedLaunchAuthorizer<TAuthorization>;
  };

export interface LtiVerifyLaunchEventOptions {
  readonly authorizeVerifiedLaunch?: undefined;
  readonly onVerificationEvent?: LtiLaunchVerificationEventObserver;
}

export type LtiLaunchVerificationResult<
  TLaunch extends LtiVerifiedLaunch = LtiVerifiedLaunch,
> =
  | {
      success: true;
      launch: TLaunch;
    }
  | {
      success: false;
      error: LtiLaunchVerificationError;
    };

export async function authorizeVerifiedLaunch<TAuthorization>(
  launch: LtiVerifiedLaunch,
  authorize: (
    launch: LtiVerifiedLaunch,
  ) =>
    | LtiVerifiedLaunchAuthorizationResult<TAuthorization>
    | Promise<LtiVerifiedLaunchAuthorizationResult<TAuthorization>>,
): Promise<LtiAuthorizedLaunch<TAuthorization>> {
  try {
    const result = await authorize(launch);
    if (!result.success) {
      throw new LtiLaunchVerificationError(
        'verified_launch_authorization_failed',
        result.message ?? `Verified launch authorization failed: ${result.code}`,
        result,
      );
    }

    return { ...launch, authorization: result.data };
  } catch (error) {
    if (error instanceof LtiLaunchVerificationError) {
      throw error;
    }

    throw new LtiLaunchVerificationError(
      'verified_launch_authorization_failed',
      `Verified launch authorization failed: ${formatError(error)}`,
      error,
    );
  }
}

export async function verifyLtiLaunch({
  idToken,
  state,
  stateSecret,
  storage,
  trustedAudiences,
  jwksCache,
  remoteJwks,
  onVerificationEvent,
}: VerifyLtiLaunchInput): Promise<LtiVerifiedLaunch> {
  const validatedParams = verifyLaunchParams(idToken, state);
  const unverified = decodeLaunchJwt(validatedParams.idToken);
  const deploymentId = readLaunchDeploymentId(unverified);
  const stateData = await readLaunchState(validatedParams.state, stateSecret);

  if (stateData.iss !== unverified.iss) {
    throw new LtiLaunchVerificationError('issuer_mismatch', 'Issuer mismatch');
  }

  const launchConfig = await readLaunchConfig(
    storage,
    unverified.iss,
    stateData.clientId,
    deploymentId,
  );
  const payload = await readVerifiedLaunchPayload({
    idToken: validatedParams.idToken,
    issuer: unverified.iss,
    deploymentId,
    launchConfig,
    jwksCache,
    remoteJwks,
    onVerificationEvent,
  });
  const validated = parseVerifiedLaunchPayload(payload);
  validateVerifiedLaunchClaims(
    validated,
    launchConfig.clientId,
    stateData,
    trustedAudiences,
  );
  await validateLaunchNonce(storage, validated.nonce);

  return {
    payload: validated,
    issuer: unverified.iss,
    clientId: launchConfig.clientId,
    deploymentId,
    targetLinkUri: stateData.targetLinkUri,
    launchConfig,
  };
}

async function readVerifiedLaunchPayload(input: {
  readonly idToken: string;
  readonly issuer: string;
  readonly deploymentId: string;
  readonly launchConfig: LTILaunchConfig;
  readonly jwksCache: LtiLaunchJwksCache;
  readonly remoteJwks?: LtiRemoteJwksOptions;
  readonly onVerificationEvent?: LtiLaunchVerificationEventObserver;
}): Promise<unknown> {
  const { payload, refetchedOnKidMiss } = await readVerifiedLaunchJwt(
    input.idToken,
    input.launchConfig,
    input.jwksCache,
    input.remoteJwks,
  );
  notifyJwksKidMissRefetch(input.onVerificationEvent, {
    refetchedOnKidMiss,
    issuer: input.issuer,
    clientId: input.launchConfig.clientId,
    deploymentId: input.deploymentId,
    jwksUrl: input.launchConfig.jwksUrl,
  });
  return payload;
}

function notifyJwksKidMissRefetch(
  observer: LtiLaunchVerificationEventObserver | undefined,
  input: LtiLaunchIdentity & {
    readonly refetchedOnKidMiss: boolean;
    readonly jwksUrl: string;
  },
): void {
  if (!input.refetchedOnKidMiss) return;

  // Keep key-rotation audit visible even when later claim or nonce checks reject the launch.
  notifyLaunchVerificationEvent(observer, {
    type: 'jwks_kid_miss_refetch',
    issuer: input.issuer,
    clientId: input.clientId,
    deploymentId: input.deploymentId,
    jwksUrl: input.jwksUrl,
  });
}

function validateVerifiedLaunchClaims(
  payload: LTI13JwtPayload,
  clientId: string,
  stateData: { nonce: string; targetLinkUri: string },
  trustedAudiences: string[] | undefined,
): void {
  if (!audienceIncludesClientId(payload.aud, clientId)) {
    throw new LtiLaunchVerificationError(
      'invalid_audience',
      `Invalid client_id: expected ${clientId}, got ${formatAudience(payload.aud)}`,
    );
  }

  validateTrustedLaunchAudiences(payload.aud, clientId, trustedAudiences);
  validateLaunchTargetLinkUri(payload, stateData.targetLinkUri);

  if (stateData.nonce !== payload.nonce) {
    throw new LtiLaunchVerificationError('nonce_mismatch', 'Nonce mismatch');
  }
}

async function validateLaunchNonce(storage: LTIStorage, nonce: string): Promise<void> {
  const isValidNonce = await storage.validateNonce(nonce);
  if (!isValidNonce) {
    throw new LtiLaunchVerificationError(
      'nonce_replay',
      'Nonce has already been used or expired',
    );
  }
}

function verifyLaunchParams(
  idToken: string,
  state: string,
): { idToken: string; state: string } {
  try {
    return VerifyLaunchParamsSchema.parse({ idToken, state });
  } catch (error) {
    throw new LtiLaunchVerificationError(
      'invalid_launch_parameters',
      `Invalid launch parameters: ${formatError(error)}`,
      error,
    );
  }
}

function decodeLaunchJwt(idToken: string): Record<string, unknown> & { iss: string } {
  let decoded: Record<string, unknown>;
  try {
    decoded = decodeJwt(idToken);
  } catch (error) {
    throw new LtiLaunchVerificationError(
      'jwt_decode_failed',
      `JWT decode failed: ${formatError(error)}`,
      error,
    );
  }

  if (typeof decoded.iss !== 'string') {
    throw new LtiLaunchVerificationError('missing_issuer', 'No issuer in token');
  }

  return { ...decoded, iss: decoded.iss };
}

function readLaunchDeploymentId(payload: Record<string, unknown>): string {
  const deploymentId = payload[LTI_CLAIM_DEPLOYMENT_ID];
  if (typeof deploymentId !== 'string') {
    throw new LtiLaunchVerificationError(
      'missing_deployment_id',
      'No deployment_id in token',
    );
  }

  return deploymentId;
}

async function readLaunchState(
  state: string,
  stateSecret: Uint8Array,
): Promise<{ clientId: string; iss: string; nonce: string; targetLinkUri: string }> {
  try {
    const { payload } = await jwtVerify(state, stateSecret);
    if (typeof payload.client_id !== 'string') {
      throw new Error('No client_id in state');
    }
    if (typeof payload.iss !== 'string') {
      throw new Error('No issuer in state');
    }
    if (typeof payload.nonce !== 'string') {
      throw new Error('No nonce in state');
    }
    if (typeof payload.target_link_uri !== 'string') {
      throw new Error('No target_link_uri in state');
    }
    HandleLoginParamsSchema.shape.target_link_uri.parse(payload.target_link_uri);

    return {
      clientId: payload.client_id,
      iss: payload.iss,
      nonce: payload.nonce,
      targetLinkUri: payload.target_link_uri,
    };
  } catch (error) {
    throw new LtiLaunchVerificationError(
      'state_verification_failed',
      `State verification failed: ${formatError(error)}`,
      error,
    );
  }
}

async function readLaunchConfig(
  storage: LTIStorage,
  issuer: string,
  clientId: string,
  deploymentId: string,
): Promise<LTILaunchConfig> {
  const launchConfig = await readStoredLaunchConfig(
    storage,
    issuer,
    clientId,
    deploymentId,
  );

  validateLaunchConfig(launchConfig, issuer, clientId, deploymentId);
  return launchConfig;
}

async function readStoredLaunchConfig(
  storage: LTIStorage,
  issuer: string,
  clientId: string,
  deploymentId: string,
): Promise<LTILaunchConfig> {
  let launchConfig: LTILaunchConfig | undefined;
  try {
    launchConfig = await resolveLaunchConfig(storage, issuer, clientId, deploymentId);
  } catch (error) {
    throw new LtiLaunchVerificationError(
      'launch_config_lookup_failed',
      `Launch config lookup failed for issuer '${issuer}', client '${clientId}', deployment '${deploymentId}'`,
      error,
    );
  }

  if (!launchConfig) {
    throw new LtiLaunchVerificationError(
      'launch_config_not_found',
      `Launch config is missing for issuer '${issuer}', client '${clientId}', deployment '${deploymentId}'`,
    );
  }

  return launchConfig;
}

function validateLaunchConfig(
  launchConfig: LTILaunchConfig,
  issuer: string,
  clientId: string,
  deploymentId: string,
): void {
  if (
    launchConfig.iss !== issuer ||
    launchConfig.clientId !== clientId ||
    launchConfig.deploymentId !== deploymentId ||
    !launchConfig.authUrl
  ) {
    throw new LtiLaunchVerificationError(
      'launch_config_invalid',
      `Launch config is invalid for issuer '${issuer}', client '${clientId}', deployment '${deploymentId}'`,
    );
  }

  if (!launchConfig.jwksUrl) {
    throw new LtiLaunchVerificationError(
      'launch_config_missing_jwks_endpoint',
      `Launch config for client '${clientId}' is missing a JWKS endpoint`,
    );
  }

  if (!launchConfig.tokenUrl) {
    throw new LtiLaunchVerificationError(
      'launch_config_missing_token_endpoint',
      `Launch config for client '${clientId}' is missing a token endpoint`,
    );
  }
}

async function readVerifiedLaunchJwt(
  idToken: string,
  launchConfig: LTILaunchConfig,
  jwksCache: LtiLaunchJwksCache,
  remoteJwks?: LtiRemoteJwksOptions,
): Promise<{ payload: unknown; refetchedOnKidMiss: boolean }> {
  try {
    return await verifyLaunchJwtWithCachedJwks(
      idToken,
      launchConfig.jwksUrl,
      launchConfig.clientId,
      { jwksCache, remoteJwks },
    );
  } catch (error) {
    throw new LtiLaunchVerificationError(
      'jwt_verification_failed',
      `JWT verification failed: ${formatError(error)}`,
      error,
    );
  }
}

async function verifyLaunchJwtWithCachedJwks(
  idToken: string,
  jwksUrl: string,
  audience: string,
  options: {
    readonly jwksCache: Map<string, RemoteJwks>;
    readonly remoteJwks?: LtiRemoteJwksOptions;
  },
): Promise<{ payload: unknown; refetchedOnKidMiss: boolean }> {
  const jwks = getOrCreateJwks(jwksUrl, options.jwksCache, options.remoteJwks);

  try {
    const { payload } = await jwtVerify(idToken, jwks, { audience });
    return { payload, refetchedOnKidMiss: false };
  } catch (error) {
    if (!isJwksNoMatchingKeyError(error)) {
      throw error;
    }

    options.jwksCache.delete(jwksUrl);
    const refreshedJwks = getOrCreateJwks(jwksUrl, options.jwksCache, options.remoteJwks);
    const { payload } = await jwtVerify(idToken, refreshedJwks, { audience });
    return { payload, refetchedOnKidMiss: true };
  }
}

function getOrCreateJwks(
  jwksUrl: string,
  jwksCache: Map<string, RemoteJwks>,
  remoteJwksOptions: LtiRemoteJwksOptions | undefined,
): RemoteJwks {
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl), remoteJwksOptions);
    jwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}

function isJwksNoMatchingKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_JWKS_NO_MATCHING_KEY'
  );
}

/** Notifies an observer without allowing observer failures to escape. */
function safeNotifyObserver<T>(
  observer: ((payload: T) => void) | undefined,
  payload: T,
): void {
  if (!observer) return;

  try {
    observer(payload);
  } catch {
    // Observers must never affect launch verification.
  }
}

/** Notifies a launch verification observer without allowing observer failures to escape. */
export function notifyLaunchVerificationEvent(
  observer: LtiLaunchVerificationEventObserver | undefined,
  event: LtiLaunchVerificationEvent,
): void {
  safeNotifyObserver(observer, event);
}

function parseVerifiedLaunchPayload(payload: unknown): LTI13JwtPayload {
  try {
    return LTI13JwtPayloadSchema.parse(payload);
  } catch (error) {
    throw new LtiLaunchVerificationError(
      'invalid_payload',
      `Invalid LTI launch payload: ${formatError(error)}`,
      error,
    );
  }
}

function audienceIncludesClientId(
  audience: LTI13JwtPayload['aud'],
  clientId: string,
): boolean {
  return Array.isArray(audience) ? audience.includes(clientId) : audience === clientId;
}

function validateTrustedLaunchAudiences(
  audience: LTI13JwtPayload['aud'],
  clientId: string,
  trustedAudiences: string[] = [],
): void {
  if (!Array.isArray(audience)) return;

  const trusted = new Set([clientId, ...trustedAudiences]);
  const untrustedAudiences = [...new Set(audience)].filter(
    (candidate) => !trusted.has(candidate),
  );

  if (untrustedAudiences.length > 0) {
    throw new LtiLaunchVerificationError(
      'untrusted_audience',
      `Untrusted audience(s): ${untrustedAudiences.join(', ')}`,
    );
  }
}

function validateLaunchTargetLinkUri(
  payload: LTI13JwtPayload,
  expectedTargetLinkUri: string,
): void {
  const targetLinkUri = payload[LTI_CLAIM_TARGET_LINK_URI];
  if (targetLinkUri !== expectedTargetLinkUri) {
    throw new LtiLaunchVerificationError(
      'target_link_uri_mismatch',
      `target_link_uri mismatch: expected ${expectedTargetLinkUri}, got ${targetLinkUri}`,
    );
  }
}

function formatAudience(audience: LTI13JwtPayload['aud']): string {
  return Array.isArray(audience) ? JSON.stringify(audience) : audience;
}
