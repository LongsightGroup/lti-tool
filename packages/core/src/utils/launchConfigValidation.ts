import type { LTILaunchConfig, LTIStorage } from '../interfaces/index.js';

export const DEFAULT_DEPLOYMENT_ID = 'default';

export async function resolveLaunchConfig(
  storage: LTIStorage,
  iss: string,
  clientId: string,
  deploymentId: string,
): Promise<LTILaunchConfig | undefined> {
  const launchConfig = await storage.getLaunchConfig(iss, clientId, deploymentId);
  if (launchConfig) return launchConfig;

  if (deploymentId === DEFAULT_DEPLOYMENT_ID) return undefined;

  return storage.getLaunchConfig(iss, clientId, DEFAULT_DEPLOYMENT_ID);
}

export async function getValidLaunchConfig(
  storage: LTIStorage,
  iss: string,
  clientId: string,
  deploymentId: string,
): Promise<LTILaunchConfig> {
  const launchConfig = await resolveLaunchConfig(storage, iss, clientId, deploymentId);

  if (!launchConfig) {
    throw new Error('No valid launch config found');
  }

  return launchConfig;
}
