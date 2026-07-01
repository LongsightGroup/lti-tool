import { describe, expect, it } from 'vitest';

import {
  LTI_CLAIM_CONTEXT,
  LTI_CLAIM_DEPLOYMENT_ID,
  LTI_CLAIM_MESSAGE_TYPE,
  LTI_CLAIM_PLATFORM_CONFIGURATION,
  LTI_CLAIM_ROLES,
  LTI_CLAIM_TARGET_LINK_URI,
  LTI_CLAIM_VERSION,
  LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
  LTI_ROLE_CONTEXT_LEARNER,
  LTI_VERSION_1P3P0,
  parsePersistedLtiDynamicRegistrationSession,
  parsePersistedLtiDynamicRegistrationSessionValue,
  parsePersistedLtiSession,
  parsePersistedLtiSessionValue,
  serializeLtiDynamicRegistrationSession,
  serializeLtiSession,
  type LTI13JwtPayload,
} from '../src/index.js';
import { createSession } from '../src/services/session.service.js';

const sampleLaunchPayload = (): LTI13JwtPayload => ({
  iss: 'https://platform.example.com',
  aud: 'client-123',
  sub: 'learner-123',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  nonce: 'nonce-123',
  [LTI_CLAIM_MESSAGE_TYPE]: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
  [LTI_CLAIM_VERSION]: LTI_VERSION_1P3P0,
  [LTI_CLAIM_DEPLOYMENT_ID]: 'deployment-123',
  [LTI_CLAIM_TARGET_LINK_URI]: 'https://tool.example.com/launch',
  [LTI_CLAIM_ROLES]: [LTI_ROLE_CONTEXT_LEARNER],
  [LTI_CLAIM_CONTEXT]: {
    id: 'course-123',
    label: 'COURSE123',
    title: 'Course 123',
  },
});

const sampleDynamicRegistrationSession = () => ({
  openIdConfiguration: {
    issuer: 'https://platform.example.com',
    authorization_endpoint: 'https://platform.example.com/authorize',
    registration_endpoint: 'https://platform.example.com/register',
    jwks_uri: 'https://platform.example.com/jwks',
    token_endpoint: 'https://platform.example.com/token',
    token_endpoint_auth_methods_supported: ['private_key_jwt'],
    token_endpoint_auth_signing_alg_values_supported: ['RS256'],
    scopes_supported: [],
    response_types_supported: ['id_token'],
    id_token_signing_alg_values_supported: ['RS256'],
    claims_supported: ['iss', 'sub'],
    subject_types_supported: ['public'],
    [LTI_CLAIM_PLATFORM_CONFIGURATION]: {
      product_family_code: 'canvas',
      version: 'cloud',
      messages_supported: [{ type: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST }],
    },
  },
  registrationToken: 'registration-token-123',
  expiresAt: Date.now() + 600_000,
});

describe('LTI session JSON codecs', () => {
  it('round-trips persisted launch sessions', () => {
    const session = createSession(sampleLaunchPayload());
    const dataJson = serializeLtiSession(session);

    expect(parsePersistedLtiSession(dataJson)).toEqual(session);
  });

  it('does not throw for malformed launch session JSON', () => {
    expect(parsePersistedLtiSession('{not-json')).toBeUndefined();
    expect(
      parsePersistedLtiSession(JSON.stringify({ id: 'session-123' })),
    ).toBeUndefined();
  });

  it('parses launch sessions from in-memory values', () => {
    const session = createSession(sampleLaunchPayload());

    expect(parsePersistedLtiSessionValue(session)).toEqual(session);
    expect(parsePersistedLtiSessionValue({ id: 'session-123' })).toBeUndefined();
  });

  it('round-trips persisted dynamic registration sessions', () => {
    const session = sampleDynamicRegistrationSession();
    const dataJson = serializeLtiDynamicRegistrationSession(session);

    expect(parsePersistedLtiDynamicRegistrationSession(dataJson)).toEqual(session);
  });

  it('does not throw for malformed dynamic registration session JSON', () => {
    expect(parsePersistedLtiDynamicRegistrationSession('{not-json')).toBeUndefined();
    expect(
      parsePersistedLtiDynamicRegistrationSession(JSON.stringify({ expiresAt: 'soon' })),
    ).toBeUndefined();
  });

  it('parses dynamic registration sessions from in-memory values', () => {
    const session = sampleDynamicRegistrationSession();

    expect(parsePersistedLtiDynamicRegistrationSessionValue(session)).toEqual(session);
    expect(
      parsePersistedLtiDynamicRegistrationSessionValue({ expiresAt: 'soon' }),
    ).toBeUndefined();
  });
});
