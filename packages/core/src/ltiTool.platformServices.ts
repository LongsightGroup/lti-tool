import type { Logger } from 'pino';

import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_LINEITEM_READONLY,
  LTI_AGS_SCOPE_RESULT_READONLY,
  LTI_AGS_SCOPE_SCORE,
} from './constants.js';
import {
  ltiServicePreconditionFailure,
  runLtiServiceCall,
  type LtiServiceResult,
} from './errors/ltiServiceError.js';
import type { LTISession } from './interfaces/ltiSession.js';
import type { LTIStorage } from './interfaces/ltiStorage.js';
import {
  type CreateLineItem,
  type LineItem,
  LineItemSchema,
  type LineItems,
  LineItemsSchema,
  type UpdateLineItem,
} from './schemas/lti13/ags/lineItem.schema.js';
import { type Results, ResultsSchema } from './schemas/lti13/ags/result.schema.js';
import type { ScoreSubmission } from './schemas/lti13/ags/scoreSubmission.schema.js';
import type { Member } from './schemas/lti13/nrps/contextMembership.schema.js';
import {
  AGSService,
  type AGSGetScoresOptions,
  type AGSLineItemTargetOptions,
  type AGSListLineItemsOptions,
} from './services/ags.service.js';
import { NRPSService } from './services/nrps.service.js';
import type { TokenService } from './services/token.service.js';
import {
  hasLtiAgsScope,
  isLtiAgsLineItemsAvailable,
} from './utils/ags.js';
import { normalizeLtiNrpsMembersResponse } from './utils/nrps.js';

const requireAgsLineItem = <T>(
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

const requireAgsLineItems = <T>(
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

const requireAgsScope = <T>(
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

const requireNrpsMembership = <T>(
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

export class LtiToolPlatformServices {
  private agsService: AGSService;
  private nrpsService: NRPSService;

  constructor(tokenService: TokenService, storage: LTIStorage, logger: Logger) {
    this.agsService = new AGSService(tokenService, storage, logger);
    this.nrpsService = new NRPSService(tokenService, storage, logger);
  }

  async submitScore(
    session: LTISession,
    score: ScoreSubmission,
  ): Promise<LtiServiceResult<void>> {
    const lineItemUrl = requireAgsLineItem<void>(session, 'submitScore');
    if (typeof lineItemUrl !== 'string') return lineItemUrl;

    const scopeError = requireAgsScope<void>(session, LTI_AGS_SCOPE_SCORE, 'submitScore');
    if (scopeError) return scopeError;

    return await runLtiServiceCall({
      serviceKind: 'ags',
      operation: 'submitScore',
      request: () => this.agsService.submitScore(session, lineItemUrl, score),
      responseBody: 'none',
    });
  }

  async getScores(
    session: LTISession,
    options: AGSGetScoresOptions = {},
  ): Promise<LtiServiceResult<Results>> {
    const lineItemUrl = requireAgsLineItem<Results>(
      session,
      'getScores',
      options.lineItemUrl,
    );
    if (typeof lineItemUrl !== 'string') return lineItemUrl;

    const scopeError = requireAgsScope<Results>(
      session,
      LTI_AGS_SCOPE_RESULT_READONLY,
      'getScores',
    );
    if (scopeError) return scopeError;

    return await runLtiServiceCall({
      serviceKind: 'ags',
      operation: 'getScores',
      request: () => this.agsService.getScores(session, lineItemUrl, options),
      responseBody: 'json',
      parse: (data) => ResultsSchema.parse(data),
    });
  }

  async listLineItems(
    session: LTISession,
    options: AGSListLineItemsOptions = {},
  ): Promise<LtiServiceResult<LineItems>> {
    const lineItemsUrl = requireAgsLineItems<LineItems>(session, 'listLineItems');
    if (typeof lineItemsUrl !== 'string') return lineItemsUrl;

    const scopeError = requireAgsScope<LineItems>(
      session,
      LTI_AGS_SCOPE_LINEITEM_READONLY,
      'listLineItems',
    );
    if (scopeError) return scopeError;

    return await runLtiServiceCall({
      serviceKind: 'ags',
      operation: 'listLineItems',
      request: () => this.agsService.listLineItems(session, lineItemsUrl, options),
      responseBody: 'json',
      parse: (data) => LineItemsSchema.parse(data),
    });
  }

  async getLineItem(
    session: LTISession,
    options: AGSLineItemTargetOptions = {},
  ): Promise<LtiServiceResult<LineItem>> {
    const lineItemUrl = requireAgsLineItem<LineItem>(
      session,
      'getLineItem',
      options.lineItemUrl,
    );
    if (typeof lineItemUrl !== 'string') return lineItemUrl;

    const scopeError = requireAgsScope<LineItem>(
      session,
      LTI_AGS_SCOPE_LINEITEM_READONLY,
      'getLineItem',
    );
    if (scopeError) return scopeError;

    return await runLtiServiceCall({
      serviceKind: 'ags',
      operation: 'getLineItem',
      request: () => this.agsService.getLineItem(session, lineItemUrl),
      responseBody: 'json',
      parse: (data) => LineItemSchema.parse(data),
    });
  }

  async createLineItem(
    session: LTISession,
    createLineItem: CreateLineItem,
  ): Promise<LtiServiceResult<LineItem>> {
    const lineItemsUrl = requireAgsLineItems<LineItem>(session, 'createLineItem');
    if (typeof lineItemsUrl !== 'string') return lineItemsUrl;

    const scopeError = requireAgsScope<LineItem>(
      session,
      LTI_AGS_SCOPE_LINEITEM,
      'createLineItem',
    );
    if (scopeError) return scopeError;

    return await runLtiServiceCall({
      serviceKind: 'ags',
      operation: 'createLineItem',
      request: () =>
        this.agsService.createLineItem(session, lineItemsUrl, createLineItem),
      responseBody: 'json',
      parse: (data) => LineItemSchema.parse(data),
    });
  }

  async updateLineItem(
    session: LTISession,
    updateLineItem: UpdateLineItem,
  ): Promise<LtiServiceResult<LineItem>> {
    const lineItemUrl = requireAgsLineItem<LineItem>(session, 'updateLineItem');
    if (typeof lineItemUrl !== 'string') return lineItemUrl;

    const scopeError = requireAgsScope<LineItem>(
      session,
      LTI_AGS_SCOPE_LINEITEM,
      'updateLineItem',
    );
    if (scopeError) return scopeError;

    return await runLtiServiceCall({
      serviceKind: 'ags',
      operation: 'updateLineItem',
      request: () => this.agsService.updateLineItem(session, lineItemUrl, updateLineItem),
      responseBody: 'json',
      parse: (data) => LineItemSchema.parse(data),
    });
  }

  async deleteLineItem(session: LTISession): Promise<LtiServiceResult<void>> {
    const lineItemUrl = requireAgsLineItem<void>(session, 'deleteLineItem');
    if (typeof lineItemUrl !== 'string') return lineItemUrl;

    const scopeError = requireAgsScope<void>(
      session,
      LTI_AGS_SCOPE_LINEITEM,
      'deleteLineItem',
    );
    if (scopeError) return scopeError;

    return await runLtiServiceCall({
      serviceKind: 'ags',
      operation: 'deleteLineItem',
      request: () => this.agsService.deleteLineItem(session, lineItemUrl),
      responseBody: 'none',
    });
  }

  async getMembers(session: LTISession): Promise<LtiServiceResult<Member[]>> {
    const membershipUrl = requireNrpsMembership<Member[]>(session, 'getMembers');
    if (typeof membershipUrl !== 'string') return membershipUrl;

    return await runLtiServiceCall({
      serviceKind: 'nrps',
      operation: 'getMembers',
      request: () => this.nrpsService.getMembers(session, membershipUrl),
      responseBody: 'json',
      parse: (data) => normalizeLtiNrpsMembersResponse(data),
    });
  }
}
