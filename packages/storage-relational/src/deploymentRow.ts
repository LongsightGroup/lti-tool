import type { LTIDeployment } from '@longsightgroup/lti-tool';

export type DeploymentRow = {
  readonly id: string;
  readonly deploymentId: string;
  readonly name: string | null;
  readonly description: string | null;
};

export type DeploymentUpdateRow = {
  readonly deploymentId: string;
  readonly name: string | null;
  readonly description: string | null;
};

export type DeploymentInsertRow = DeploymentUpdateRow;

export function mapDeploymentRow(row: DeploymentRow): LTIDeployment {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    name: row.name ?? undefined,
    description: row.description ?? undefined,
  };
}

export function toDeploymentInsertRow(
  deployment: Omit<LTIDeployment, 'id'>,
): DeploymentInsertRow {
  return {
    deploymentId: deployment.deploymentId,
    name: deployment.name ?? null,
    description: deployment.description ?? null,
  };
}

export function toDeploymentUpdateRow(deployment: LTIDeployment): DeploymentUpdateRow {
  return {
    deploymentId: deployment.deploymentId,
    name: deployment.name ?? null,
    description: deployment.description ?? null,
  };
}
