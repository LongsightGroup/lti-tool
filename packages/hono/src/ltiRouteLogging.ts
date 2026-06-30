import { createNoopLogger } from '@longsightgroup/lti-tool';
import type { Logger } from 'pino';

export type LtiRouteLoggerOptions = {
  logger?: Logger;
};

export function createLtiRouteLogger(options?: LtiRouteLoggerOptions): Logger {
  return options?.logger ?? createNoopLogger();
}
