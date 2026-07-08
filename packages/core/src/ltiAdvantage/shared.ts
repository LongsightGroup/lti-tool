import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_LINEITEM_READONLY,
  LTI_AGS_SCOPE_RESULT_READONLY,
  LTI_AGS_SCOPE_SCORE,
} from '../constants.js';
import {
  ltiServicePreconditionFailure,
  runLtiServiceCall,
  type LtiServiceResult,
} from '../errors/ltiServiceError.js';
import type { LTISession } from '../interfaces/ltiSession.js';
import { hasLtiAgsScope, isLtiAgsLineItemsAvailable } from '../utils/ags.js';

export const requireAgsLineItem = <T>(
  session: LTISession,
  operation: string,
  lineItemUrl = session.services?.ags?.lineitem,
): string | LtiServiceResult<T> => {
  const resolved = lineItemUrl ?? session.services?.ags?.lineitem;
  if (resolved !== undefined) return resolved;

  return ltiServicePreconditionFailure({
    code: 'service_not_available',
    serviceKind: 'ags',
    operation,
    message: 'AGS line item service is not available for this session',
  });
};

export const requireAgsLineItems = <T>(
  session: LTISession,
  operation: string,
): string | LtiServiceResult<T> => {
  const ags = session.services?.ags;
  if (isLtiAgsLineItemsAvailable(session) && ags?.lineitems !== undefined) {
    return ags.lineitems;
  }

  return ltiServicePreconditionFailure({
    code: 'service_not_available',
    serviceKind: 'ags',
    operation,
    message: 'AGS line items service is not available for this session',
  });
};

export const requireAgsScope = <T>(
  session: LTISession,
  scope: string,
  operation: string,
): LtiServiceResult<T> | undefined => {
  if (hasLtiAgsScope(session, scope)) return undefined;

  return ltiServicePreconditionFailure({
    code: 'missing_required_scope',
    serviceKind: 'ags',
    operation,
    message: `Missing required AGS scope '${scope}'`,
  });
};

export const requireNrpsMembership = <T>(
  session: LTISession,
  operation: string,
): string | LtiServiceResult<T> => {
  if (session.services?.nrps?.membershipUrl) return session.services.nrps.membershipUrl;

  return ltiServicePreconditionFailure({
    code: 'service_not_available',
    serviceKind: 'nrps',
    operation,
    message: 'NRPS membership service is not available for this session',
  });
};

export type AgsUrlResolver<T> = () => string | LtiServiceResult<T>;

export const runAgsJsonOperation = <T>(
  session: LTISession,
  input: {
    operation: string;
    scope: string;
    resolveUrl: AgsUrlResolver<T>;
    parse: (data: unknown) => T;
    request: (url: string) => Promise<Response>;
  },
): Promise<LtiServiceResult<T>> => {
  const url = input.resolveUrl();
  if (typeof url !== 'string') return Promise.resolve(url);

  const scopeError = requireAgsScope<T>(session, input.scope, input.operation);
  if (scopeError) return Promise.resolve(scopeError);

  return runLtiServiceCall({
    serviceKind: 'ags',
    operation: input.operation,
    request: () => input.request(url),
    responseBody: 'json',
    parse: input.parse,
  });
};

export const runAgsEmptyOperation = (
  session: LTISession,
  input: {
    operation: string;
    scope: string;
    resolveUrl: AgsUrlResolver<void>;
    request: (url: string) => Promise<Response>;
  },
): Promise<LtiServiceResult<void>> => {
  const url = input.resolveUrl();
  if (typeof url !== 'string') return Promise.resolve(url);

  const scopeError = requireAgsScope<void>(session, input.scope, input.operation);
  if (scopeError) return Promise.resolve(scopeError);

  return runLtiServiceCall({
    serviceKind: 'ags',
    operation: input.operation,
    request: () => input.request(url),
    responseBody: 'none',
  });
};

export const AGS_LINEITEM_SCOPE = LTI_AGS_SCOPE_LINEITEM;
export const AGS_LINEITEM_READONLY_SCOPE = LTI_AGS_SCOPE_LINEITEM_READONLY;
export const AGS_RESULT_READONLY_SCOPE = LTI_AGS_SCOPE_RESULT_READONLY;
export const AGS_SCORE_SCOPE = LTI_AGS_SCOPE_SCORE;
