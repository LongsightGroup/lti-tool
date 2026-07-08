import type {
  DynamicRegistrationAppState,
  DynamicRegistrationForm,
  JWKS,
  LtiDynamicRegistration,
  LtiDynamicRegistrationCompletionResult,
  LtiDynamicRegistrationInitiationOptions,
  LtiLaunchVerificationResult,
  LtiLogger,
  LtiToolPort,
  LtiVerifyLaunchOptions,
  LtiVerifiedLaunch,
  LTISession,
  RegistrationRequest,
} from '@longsightgroup/lti-tool';
import type { Context } from 'hono';

import type { HonoLtiLaunchVerificationEventObserver } from './ltiRoutes/launchFlow.js';

export type LtiJwksRouteDeps = {
  getJWKS: () => Promise<JWKS>;
  logger: LtiLogger;
};

export type LtiLoginRouteDeps = {
  handleLogin: LtiToolPort['handleLogin'];
  logger: LtiLogger;
};

export type LtiLaunchRouteDeps = {
  verifyLaunch: (
    idToken: string,
    state: string,
    options?: Pick<LtiVerifyLaunchOptions, 'onVerificationEvent'>,
  ) => Promise<LtiLaunchVerificationResult>;
  createSessionFromVerifiedLaunch: (launch: LtiVerifiedLaunch) => Promise<LTISession>;
  onVerificationEvent?: HonoLtiLaunchVerificationEventObserver;
  logger: LtiLogger;
};

export type LtiDeepLinkRouteDeps = {
  getSession: (sessionId: string) => Promise<LTISession | undefined>;
  logger: LtiLogger;
};

export type LtiInitiateDynamicRegistrationRouteDeps = {
  initiateDynamicRegistration: (
    request: RegistrationRequest,
    routePath: string,
    options?: LtiDynamicRegistrationInitiationOptions,
  ) => ReturnType<LtiDynamicRegistration['initiateDynamicRegistration']>;
  getDynamicRegistrationAppState?: (context: {
    hono: Context;
    registrationRequest: RegistrationRequest;
  }) =>
    | DynamicRegistrationAppState
    | undefined
    | Promise<DynamicRegistrationAppState | undefined>;
  logger: LtiLogger;
};

export type LtiCompleteDynamicRegistrationRouteDeps = {
  completeDynamicRegistration: (
    form: DynamicRegistrationForm,
  ) => ReturnType<LtiDynamicRegistration['completeDynamicRegistration']>;
  /** Runs after core stores the registration. Failures are logged and do not change the success response. */
  onRegistrationComplete?: (
    result: LtiDynamicRegistrationCompletionResult,
  ) => void | Promise<void>;
  logger: LtiLogger;
};

export type LtiSessionMiddlewareDeps = {
  getSession: (sessionId: string) => Promise<LTISession | undefined>;
};
