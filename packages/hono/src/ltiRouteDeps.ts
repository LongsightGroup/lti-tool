import type {
  DynamicRegistrationForm,
  LtiLaunchVerificationResult,
  LtiVerifiedLaunch,
  LTISession,
  LTITool,
  RegistrationRequest,
} from '@longsightgroup/lti-tool';
import type { Logger } from 'pino';

export type LtiJwksRouteDeps = {
  getJWKS: () => ReturnType<LTITool['getJWKS']>;
  logger: Logger;
};

export type LtiLoginRouteDeps = {
  handleLogin: LTITool['handleLogin'];
  logger: Logger;
};

export type LtiLaunchRouteDeps = {
  verifyLaunch: (idToken: string, state: string) => Promise<LtiLaunchVerificationResult>;
  createSessionFromVerifiedLaunch: (launch: LtiVerifiedLaunch) => Promise<LTISession>;
  logger: Logger;
};

export type LtiDeepLinkRouteDeps = {
  getSession: (sessionId: string) => Promise<LTISession | undefined>;
  logger: Logger;
};

export type LtiInitiateDynamicRegistrationRouteDeps = {
  initiateDynamicRegistration: (
    request: RegistrationRequest,
    routePath: string,
  ) => ReturnType<LTITool['initiateDynamicRegistration']>;
  logger: Logger;
};

export type LtiCompleteDynamicRegistrationRouteDeps = {
  completeDynamicRegistration: (
    form: DynamicRegistrationForm,
  ) => ReturnType<LTITool['completeDynamicRegistration']>;
  logger: Logger;
};

export type LtiSessionMiddlewareDeps = {
  getSession: (sessionId: string) => Promise<LTISession | undefined>;
};
