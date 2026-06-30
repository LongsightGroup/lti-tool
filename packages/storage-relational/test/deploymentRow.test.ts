import { describe, expect, it } from 'vitest';

import { createMockLTIPayload } from '../../core/test/helpers/fixtures.js';
import {
  mapDeploymentRow,
  toDeploymentInsertRow,
  toDeploymentUpdateRow,
} from '../src/deploymentRow.js';
import {
  parseRegistrationSessionDataRow,
  parseSessionDataRow,
  toSessionDataRow,
} from '../src/storageRows.js';

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

describe('shared storage row mapping', () => {
  it('splits and reconstructs persisted session data', () => {
    const session = {
      id: 'session-id',
      jwtPayload: createMockLTIPayload(),
      user: { id: 'user-id', roles: ['Learner'] },
      context: { id: 'context-id', label: 'TEST101', title: 'Test Course' },
      platform: {
        issuer: 'https://platform.example.com',
        clientId: 'client-id',
        deploymentId: 'deployment-id',
        name: 'Platform',
      },
      launch: { target: 'https://tool.example.com/launch' },
      customParameters: {},
      isAdmin: false,
      isInstructor: false,
      isStudent: true,
      isAssignmentAndGradesAvailable: false,
      isDeepLinkingAvailable: false,
      isNameAndRolesAvailable: false,
    };

    expect(parseSessionDataRow(toSessionDataRow(session))).toEqual(session);
  });

  it('rejects invalid persisted session data', () => {
    const warnings: unknown[] = [];
    const logger = {
      warn: (payload: unknown) => {
        warnings.push(payload);
      },
    };

    expect(
      parseSessionDataRow(
        {
          id: 'session-id',
          data: { user: { id: 'missing-required-fields' } } as never,
        },
        logger,
      ),
    ).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('rejects invalid persisted registration session data', () => {
    const warnings: unknown[] = [];
    const logger = {
      warn: (payload: unknown) => {
        warnings.push(payload);
      },
    };

    expect(
      parseRegistrationSessionDataRow({ data: { state: 'expired' } as never }, logger),
    ).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});
