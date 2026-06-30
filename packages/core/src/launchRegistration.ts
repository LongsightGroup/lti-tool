import type { LTIClient } from './interfaces/ltiClient.js';
import type { LTIDeployment } from './interfaces/ltiDeployment.js';
import type { LTILaunchConfig } from './interfaces/ltiLaunchConfig.js';
import type { LTIStorage } from './interfaces/ltiStorage.js';
import { AddClientSchema } from './schemas/client.schema.js';

export interface LtiLaunchRegistrationInput {
  /** Platform issuer URL that uniquely identifies the LMS */
  iss: string;
  /** OAuth2 client identifier assigned by the platform */
  clientId: string;
  /** LMS-provided deployment identifier used in LTI launch requests */
  deploymentId: string;
  /** Platform's OIDC authentication endpoint URL */
  authUrl: string;
  /** Platform's OAuth2 token endpoint URL for service access */
  tokenUrl: string;
  /** Platform's JSON Web Key Set endpoint URL for JWT verification */
  jwksUrl: string;
  /** Optional human-readable platform name. Defaults to the issuer for new clients. */
  name?: string;
  /** Optional human-readable deployment name when creating or updating the deployment. */
  deploymentName?: string;
  /** Optional deployment description when creating or updating the deployment. */
  deploymentDescription?: string;
}

export interface LtiLaunchRegistrationUpsertResult {
  client: LTIClient;
  deployment: LTIDeployment;
  launchConfig: LTILaunchConfig;
  createdClient: boolean;
  createdDeployment: boolean;
}

type StoredClient = Omit<LTIClient, 'deployments'>;

const launchRegistrationClientInput = (
  registration: LtiLaunchRegistrationInput,
  existingClient?: StoredClient,
): Omit<LTIClient, 'id' | 'deployments'> => {
  return AddClientSchema.parse({
    name: registration.name ?? existingClient?.name ?? registration.iss,
    iss: registration.iss,
    clientId: registration.clientId,
    authUrl: registration.authUrl,
    tokenUrl: registration.tokenUrl,
    jwksUrl: registration.jwksUrl,
  });
};

const findLaunchRegistrationClient = async (
  storage: LTIStorage,
  registration: LtiLaunchRegistrationInput,
): Promise<StoredClient | undefined> => {
  const clients = await storage.listClients();
  return clients.find(
    (client) =>
      client.iss === registration.iss && client.clientId === registration.clientId,
  );
};

const upsertLaunchRegistrationClient = async (
  storage: LTIStorage,
  registration: LtiLaunchRegistrationInput,
): Promise<{ client: StoredClient; createdClient: boolean }> => {
  const existingClient = await findLaunchRegistrationClient(storage, registration);
  const clientInput = launchRegistrationClientInput(registration, existingClient);

  if (existingClient === undefined) {
    const clientId = await storage.addClient(clientInput);
    return { client: { id: clientId, ...clientInput }, createdClient: true };
  }

  await storage.updateClient(existingClient.id, clientInput);
  return { client: { id: existingClient.id, ...clientInput }, createdClient: false };
};

const launchRegistrationDeploymentInput = (
  registration: LtiLaunchRegistrationInput,
): Omit<LTIDeployment, 'id'> => ({
  deploymentId: registration.deploymentId,
  ...(registration.deploymentName === undefined
    ? {}
    : { name: registration.deploymentName }),
  ...(registration.deploymentDescription === undefined
    ? {}
    : { description: registration.deploymentDescription }),
});

const upsertLaunchRegistrationDeployment = async (
  storage: LTIStorage,
  clientId: string,
  registration: LtiLaunchRegistrationInput,
): Promise<{
  deployment: LTIDeployment;
  createdDeployment: boolean;
}> => {
  const existingDeployment = await storage.getDeploymentByPlatformId(
    clientId,
    registration.deploymentId,
  );
  const deploymentInput = launchRegistrationDeploymentInput(registration);

  if (existingDeployment === undefined) {
    return {
      deployment: {
        id: await storage.addDeployment(clientId, deploymentInput),
        ...deploymentInput,
      },
      createdDeployment: true,
    };
  }

  const deployment = { ...existingDeployment, ...deploymentInput };

  if (
    registration.deploymentName !== undefined ||
    registration.deploymentDescription !== undefined
  ) {
    await storage.updateDeploymentById(clientId, existingDeployment.id, deploymentInput);
  }

  return {
    deployment,
    createdDeployment: false,
  };
};

const launchConfigFromRegistration = (
  registration: LtiLaunchRegistrationInput,
): LTILaunchConfig => ({
  iss: registration.iss,
  clientId: registration.clientId,
  deploymentId: registration.deploymentId,
  authUrl: registration.authUrl,
  tokenUrl: registration.tokenUrl,
  jwksUrl: registration.jwksUrl,
});

export async function upsertLaunchRegistration(
  storage: LTIStorage,
  registration: LtiLaunchRegistrationInput,
): Promise<LtiLaunchRegistrationUpsertResult> {
  const { client, createdClient } = await upsertLaunchRegistrationClient(
    storage,
    registration,
  );
  const { deployment, createdDeployment } = await upsertLaunchRegistrationDeployment(
    storage,
    client.id,
    registration,
  );
  const deployments = await storage.listDeployments(client.id);
  const launchConfig = launchConfigFromRegistration(registration);
  await storage.saveLaunchConfig(launchConfig);

  return {
    client: { ...client, deployments },
    deployment,
    launchConfig,
    createdClient,
    createdDeployment,
  };
}
