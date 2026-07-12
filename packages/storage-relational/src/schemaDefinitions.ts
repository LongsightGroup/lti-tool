/** Shared physical SQL identifiers for LTI relational storage adapters. */

export const LTI_ID_LENGTH = 36;
export const LTI_NAME_LENGTH = 255;
export const LTI_ISS_LENGTH = 255;
export const LTI_CLIENT_ID_LENGTH = 255;
export const LTI_DEPLOYMENT_ID_LENGTH = 255;
export const LTI_NONCE_LENGTH = 255;

export const LTI_TABLES = {
  clients: 'lti_clients',
  deployments: 'lti_deployments',
  sessions: 'lti_sessions',
  nonces: 'lti_nonces',
  registrationSessions: 'lti_registration_sessions',
} as const;

export const LTI_COLUMNS = {
  id: 'id',
  tenantId: 'tenant_id',
  platformName: 'platform_name',
  deploymentName: 'deployment_name',
  deploymentDescription: 'deployment_description',
  payload: 'payload',
  iss: 'iss',
  clientId: 'client_id',
  authUrl: 'auth_url',
  tokenUrl: 'token_url',
  jwksUrl: 'jwks_url',
  deploymentId: 'deployment_id',
  expiresAt: 'expires_at',
  nonce: 'nonce',
} as const;

export const LTI_INDEXES = {
  clientsIssuerClient: 'lti_clients_issuer_client_idx',
  deploymentsDeploymentId: 'lti_deployments_deployment_id_idx',
  sessionsExpiresAt: 'lti_sessions_expires_at_idx',
  noncesExpiresAt: 'lti_nonces_expires_at_idx',
  registrationSessionsExpiresAt: 'lti_registration_sessions_expires_at_idx',
} as const;

export const LTI_UNIQUES = {
  clientsIssClientId: 'lti_clients_iss_client_id_uniq',
  deploymentsClientDeployment: 'lti_deployments_client_deployment_uniq',
} as const;

/** Cross-vendor reserved words that must not appear as bare SQL identifiers. */
export const LTI_RESERVED_WORDS = new Set([
  'name',
  'data',
  'user',
  'order',
  'group',
  'session',
  'date',
  'time',
  'timestamp',
  'year',
  'month',
  'day',
  'level',
  'size',
  'row',
  'key',
  'value',
  'type',
  'status',
  'role',
  'password',
  'comment',
  'offset',
  'limit',
  'cursor',
  'grant',
  'option',
  'check',
  'table',
  'view',
  'column',
  'schema',
  'index',
  'database',
  'number',
  'char',
  'varchar',
  'integer',
  'float',
  'real',
  'double',
  'decimal',
  'numeric',
  'blob',
  'clob',
]);

export const LTI_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Validates a physical SQL identifier against naming rules. */
export function assertSafeIdentifier(identifier: string): void {
  if (!LTI_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  if (LTI_RESERVED_WORDS.has(identifier)) {
    throw new Error(`Reserved SQL word used as identifier: ${identifier}`);
  }
}

/** Returns all exported LTI physical SQL identifiers for validation tests. */
export function collectLtiSqlIdentifiers(): readonly string[] {
  return [
    ...Object.values(LTI_TABLES),
    ...Object.values(LTI_COLUMNS),
    ...Object.values(LTI_INDEXES),
    ...Object.values(LTI_UNIQUES),
  ];
}
