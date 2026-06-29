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
  const parsedJson = parseJson(dataJson);
  const parsedSession = LTISessionSchema.safeParse(parsedJson);

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
  const parsedJson = parseJson(dataJson);
  const parsedSession = LTIDynamicRegistrationSessionSchema.safeParse(parsedJson);

  return parsedSession.success ? parsedSession.data : undefined;
}
