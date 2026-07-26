import {
  LTIDynamicRegistrationSessionSchema,
  LTISessionSchema,
  type LTIClient,
  type LTIDynamicRegistrationSession,
  type LTILaunchConfig,
  type LtiLogger,
  type LTISession,
} from '@longsightgroup/lti-tool';

export type ClientRow = Omit<LTIClient, 'deployments'>;

export type SessionDataRow = {
  readonly id: string;
  readonly data: Omit<LTISession, 'id'>;
};

export type RegistrationSessionDataRow = {
  readonly data: unknown;
};

export type LaunchConfigRow = LTILaunchConfig;

export function projectClient(client: ClientRow): Omit<LTIClient, 'deployments'> {
  return {
    id: client.id,
    name: client.name,
    iss: client.iss,
    clientId: client.clientId,
    authUrl: client.authUrl,
    tokenUrl: client.tokenUrl,
    jwksUrl: client.jwksUrl,
  };
}

export function toSessionDataRow(session: LTISession): SessionDataRow {
  const { id, ...data } = session;
  return { id, data };
}

export function parseSessionDataRow(
  row: SessionDataRow,
  logger?: Pick<LtiLogger, 'warn'>,
): LTISession | undefined {
  const parsed = LTISessionSchema.safeParse({ id: row.id, ...row.data });
  if (!parsed.success) {
    logger?.warn(
      { sessionId: row.id, issues: parsed.error.issues },
      'invalid persisted session data',
    );
    return undefined;
  }

  return parsed.data;
}

export function parseRegistrationSessionDataRow(
  row: RegistrationSessionDataRow,
  logger?: Pick<LtiLogger, 'warn'>,
): LTIDynamicRegistrationSession | undefined {
  const parsed = LTIDynamicRegistrationSessionSchema.safeParse(row.data);
  if (!parsed.success) {
    logger?.warn(
      { issues: parsed.error.issues },
      'invalid persisted registration session data',
    );
    return undefined;
  }

  return parsed.data;
}
