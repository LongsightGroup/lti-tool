import type { LTIDynamicRegistrationSession, LTISession } from '../interfaces/index.js';
import {
  LTIDynamicRegistrationSessionSchema,
  LTISessionSchema,
} from '../schemas/index.js';

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }
}

export function serializeLtiSession(session: LTISession): string {
  return JSON.stringify(LTISessionSchema.parse(session));
}

export function parsePersistedLtiSession(dataJson: string): LTISession | undefined {
  return parsePersistedLtiSessionValue(parseJson(dataJson));
}

export function parsePersistedLtiSessionValue(value: unknown): LTISession | undefined {
  const parsedSession = LTISessionSchema.safeParse(value);

  return parsedSession.success ? parsedSession.data : undefined;
}

export function serializeLtiDynamicRegistrationSession(
  session: LTIDynamicRegistrationSession,
): string {
  return JSON.stringify(LTIDynamicRegistrationSessionSchema.parse(session));
}

export function parsePersistedLtiDynamicRegistrationSession(
  dataJson: string,
): LTIDynamicRegistrationSession | undefined {
  return parsePersistedLtiDynamicRegistrationSessionValue(parseJson(dataJson));
}

export function parsePersistedLtiDynamicRegistrationSessionValue(
  value: unknown,
): LTIDynamicRegistrationSession | undefined {
  const parsedSession = LTIDynamicRegistrationSessionSchema.safeParse(value);

  return parsedSession.success ? parsedSession.data : undefined;
}
