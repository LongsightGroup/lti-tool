import type { LtiLogger } from '@longsightgroup/lti-tool';

export interface DynamoDbStorageConfig {
  tenantId: string;
  logger?: LtiLogger;
  controlPlaneTable: string;
  dataPlaneTable: string;
  launchConfigTable: string;
  /** Nonce expiration time in seconds (defaults to 600) */
  nonceExpirationSeconds?: number;
}
