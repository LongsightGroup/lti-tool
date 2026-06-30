import { describe, expect, it } from 'vitest';

import {
  mapDeploymentRow,
  toDeploymentInsertRow,
  toDeploymentUpdateRow,
} from '../src/deploymentRow.js';

describe('deployment row mapping', () => {
  it('normalizes optional deployment fields to nullable database fields on insert', () => {
    expect(toDeploymentInsertRow({ deploymentId: 'platform-deployment-id' })).toEqual({
      deploymentId: 'platform-deployment-id',
      name: null,
      description: null,
    });
  });

  it('does not include unknown deployment fields in insert rows', () => {
    const deployment = {
      deploymentId: 'platform-deployment-id',
      name: 'Deployment',
      description: 'Deployment description',
      unexpected: 'should not reach drizzle values',
    };

    expect(toDeploymentInsertRow(deployment)).toEqual({
      deploymentId: 'platform-deployment-id',
      name: 'Deployment',
      description: 'Deployment description',
    });
  });

  it('maps nullable database fields back to optional deployment fields', () => {
    expect(
      mapDeploymentRow({
        id: 'internal-id',
        deploymentId: 'platform-deployment-id',
        name: null,
        description: null,
      }),
    ).toEqual({
      id: 'internal-id',
      deploymentId: 'platform-deployment-id',
      name: undefined,
      description: undefined,
    });
  });

  it('normalizes optional deployment fields to nullable database fields on update', () => {
    expect(
      toDeploymentUpdateRow({
        id: 'internal-id',
        deploymentId: 'platform-deployment-id',
      }),
    ).toEqual({
      deploymentId: 'platform-deployment-id',
      name: null,
      description: null,
    });
  });
});
