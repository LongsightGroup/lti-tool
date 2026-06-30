import type { LTIDeployment } from '@longsightgroup/lti-tool';

import type { DynamoBase } from './dynamoBase.js';

export interface DynamoLTIDeployment extends LTIDeployment, DynamoBase {
  type: 'Deployment';
  gsi2pk: string;
  gsi2sk: string;
}
