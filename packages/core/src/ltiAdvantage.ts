import {
  ltiServicePreconditionFailure,
  runLtiServiceOperation,
  type LtiServiceResult,
} from './errors/ltiServiceError.js';
import type { LtiLogger } from './interfaces/ltiLogger.js';
import type { LTISession } from './interfaces/ltiSession.js';
import type { LTIStorage } from './interfaces/ltiStorage.js';
import {
  findOrCreateLineItem as runFindOrCreateLineItem,
  type LtiAdvantageAgsLineItemsDeps,
} from './ltiAdvantage/agsLineItems.js';
import {
  getNrpsMembers,
  getNrpsMembersPage,
  type LtiAdvantageNrpsDeps,
} from './ltiAdvantage/nrps.js';
import {
  AGS_LINEITEM_READONLY_SCOPE,
  AGS_LINEITEM_SCOPE,
  AGS_RESULT_READONLY_SCOPE,
  AGS_SCORE_SCOPE,
  requireAgsLineItem,
  requireAgsLineItems,
  runAgsEmptyOperation,
  runAgsJsonOperation,
} from './ltiAdvantage/shared.js';
import type {
  FindOrCreateLineItemInput,
  NrpsGetMembersOptions,
  NrpsMembersPage,
  NrpsMembersResult,
} from './ltiAdvantage/types.js';
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
import type { DeepLinkingContentItem } from './schemas/lti13/deepLinking/contentItem.schema.js';
import type { Member } from './schemas/lti13/nrps/contextMembership.schema.js';
import {
  AGSService,
  type AGSGetScoresOptions,
  type AGSLineItemTargetOptions,
  type AGSListLineItemsOptions,
} from './services/ags.service.js';
import { DeepLinkingService } from './services/deepLinking.service.js';
import { NRPSService } from './services/nrps.service.js';
import type { TokenService } from './services/token.service.js';

export type {
  FindOrCreateLineItemInput,
  NrpsGetMembersOptions,
  NrpsMembersPage,
  NrpsMembersPagination,
  NrpsMembersResult,
} from './ltiAdvantage/types.js';

type LtiAdvantageServices = {
  readonly agsService: AGSService;
  readonly nrpsService: NRPSService;
  readonly deepLinkingService: DeepLinkingService;
};

export type LtiAdvantageInput = {
  readonly session: LTISession;
  readonly tokenService: TokenService;
  readonly storage: LTIStorage;
  readonly keyPair: CryptoKeyPair;
  readonly keyId: string;
  readonly logger: LtiLogger;
};

/**
 * Session-bound LTI Advantage facade for AGS, NRPS, and Deep Linking.
 */
export interface LtiAgsClient {
  submitScore: LtiAdvantage['submitScore'];
  getScores: LtiAdvantage['getScores'];
  listLineItems: LtiAdvantage['listLineItems'];
  getLineItem: LtiAdvantage['getLineItem'];
  createLineItem: LtiAdvantage['createLineItem'];
  updateLineItem: LtiAdvantage['updateLineItem'];
  deleteLineItem: LtiAdvantage['deleteLineItem'];
  findOrCreateLineItem: LtiAdvantage['findOrCreateLineItem'];
}

/**
 * Session-bound Names and Role Provisioning Services client.
 */
export interface LtiNrpsClient {
  getMembers: LtiAdvantage['getMembers'];
  getMembersPage: LtiAdvantage['getMembersPage'];
}

/**
 * Session-bound Deep Linking client.
 */
export interface LtiDeepLinkingClient {
  createDeepLinkingResponse: LtiAdvantage['createDeepLinkingResponse'];
  createDeepLinkingHtmlResponse: LtiAdvantage['createDeepLinkingHtmlResponse'];
}

/**
 * Complete session-bound LTI Advantage facade.
 */
export interface LtiAdvantagePort
  extends LtiAgsClient, LtiNrpsClient, LtiDeepLinkingClient {}

export class LtiAdvantage {
  private readonly session: LTISession;
  private readonly services: LtiAdvantageServices;

  /**
   * Creates a session-bound Advantage facade.
   *
   * @param input - Session and service dependencies supplied by LTITool.
   */
  constructor(input: LtiAdvantageInput) {
    this.session = input.session;
    this.services = {
      agsService: new AGSService(input.tokenService, input.storage, input.logger),
      nrpsService: new NRPSService(input.tokenService, input.storage, input.logger),
      deepLinkingService: new DeepLinkingService(
        input.keyPair,
        input.logger,
        input.keyId,
      ),
    };
  }

  /**
   * Submits a grade score to the platform using Assignment and Grade Services.
   */
  async submitScore(score: ScoreSubmission): Promise<LtiServiceResult<void>> {
    return await runAgsEmptyOperation(this.session, {
      operation: 'submitScore',
      scope: AGS_SCORE_SCOPE,
      resolveUrl: () => requireAgsLineItem<void>(this.session, 'submitScore'),
      request: (url) => this.services.agsService.submitScore(this.session, url, score),
    });
  }

  /**
   * Retrieves all scores for a line item from the platform.
   */
  async getScores(options: AGSGetScoresOptions = {}): Promise<LtiServiceResult<Results>> {
    return await runAgsJsonOperation(this.session, {
      operation: 'getScores',
      scope: AGS_RESULT_READONLY_SCOPE,
      resolveUrl: () =>
        requireAgsLineItem<Results>(this.session, 'getScores', options.lineItemUrl),
      parse: (data) => ResultsSchema.parse(data),
      request: (url) => this.services.agsService.getScores(this.session, url, options),
    });
  }

  /**
   * Lists platform gradebook line items.
   */
  async listLineItems(
    options: AGSListLineItemsOptions = {},
  ): Promise<LtiServiceResult<LineItems>> {
    return await runAgsJsonOperation(this.session, {
      operation: 'listLineItems',
      scope: AGS_LINEITEM_READONLY_SCOPE,
      resolveUrl: () => requireAgsLineItems<LineItems>(this.session, 'listLineItems'),
      parse: (data) => LineItemsSchema.parse(data),
      request: (url) =>
        this.services.agsService.listLineItems(this.session, url, options),
    });
  }

  /**
   * Retrieves a single platform gradebook line item.
   */
  async getLineItem(
    options: AGSLineItemTargetOptions = {},
  ): Promise<LtiServiceResult<LineItem>> {
    return await runAgsJsonOperation(this.session, {
      operation: 'getLineItem',
      scope: AGS_LINEITEM_READONLY_SCOPE,
      resolveUrl: () =>
        requireAgsLineItem<LineItem>(this.session, 'getLineItem', options.lineItemUrl),
      parse: (data) => LineItemSchema.parse(data),
      request: (url) => this.services.agsService.getLineItem(this.session, url),
    });
  }

  /**
   * Creates a platform gradebook line item.
   */
  async createLineItem(
    createLineItem: CreateLineItem,
  ): Promise<LtiServiceResult<LineItem>> {
    return await runAgsJsonOperation(this.session, {
      operation: 'createLineItem',
      scope: AGS_LINEITEM_SCOPE,
      resolveUrl: () => requireAgsLineItems<LineItem>(this.session, 'createLineItem'),
      parse: (data) => LineItemSchema.parse(data),
      request: (url) =>
        this.services.agsService.createLineItem(this.session, url, createLineItem),
    });
  }

  /**
   * Updates the session's target platform gradebook line item.
   */
  async updateLineItem(
    updateLineItem: UpdateLineItem,
  ): Promise<LtiServiceResult<LineItem>> {
    return await runAgsJsonOperation(this.session, {
      operation: 'updateLineItem',
      scope: AGS_LINEITEM_SCOPE,
      resolveUrl: () => requireAgsLineItem<LineItem>(this.session, 'updateLineItem'),
      parse: (data) => LineItemSchema.parse(data),
      request: (url) =>
        this.services.agsService.updateLineItem(this.session, url, updateLineItem),
    });
  }

  /**
   * Deletes the session's target platform gradebook line item.
   */
  async deleteLineItem(): Promise<LtiServiceResult<void>> {
    return await runAgsEmptyOperation(this.session, {
      operation: 'deleteLineItem',
      scope: AGS_LINEITEM_SCOPE,
      resolveUrl: () => requireAgsLineItem<void>(this.session, 'deleteLineItem'),
      request: (url) => this.services.agsService.deleteLineItem(this.session, url),
    });
  }

  /**
   * Finds an existing line item matching the provided identity keys, or creates one.
   *
   * At least one of `resourceLinkId`, `resourceId`, or `tag` must be supplied. Matching
   * is exact on each provided key; omitted keys are not compared.
   *
   * This operation is not atomic. Concurrent launches can race to create duplicate line
   * items; on create failure the platform is re-listed and the first deterministic
   * match (sorted by line item id) is returned when present.
   */
  findOrCreateLineItem(
    input: FindOrCreateLineItemInput,
  ): Promise<LtiServiceResult<LineItem>> {
    return runFindOrCreateLineItem(this.agsLineItemsDeps(), input);
  }

  /**
   * Retrieves one page of course/context members using Names and Role Provisioning Services.
   */
  getMembersPage(pageUrl?: string): Promise<LtiServiceResult<NrpsMembersPage>> {
    return getNrpsMembersPage(this.nrpsDeps(), pageUrl);
  }

  /**
   * Retrieves course/context members using Names and Role Provisioning Services.
   *
   * By default only the first page is returned. Large courses may be silently truncated;
   * pass `{ followPagination: true }` to follow Link rel="next" pages up to `maxPages`.
   */
  getMembers(): Promise<LtiServiceResult<Member[]>>;
  getMembers(options: {
    readonly followPagination?: false | undefined;
  }): Promise<LtiServiceResult<Member[]>>;
  getMembers(options: {
    readonly followPagination: true;
    readonly maxPages?: number;
  }): Promise<LtiServiceResult<NrpsMembersResult>>;
  getMembers(
    options: NrpsGetMembersOptions = {},
  ): Promise<LtiServiceResult<Member[] | NrpsMembersResult>> {
    return getNrpsMembers(this.nrpsDeps(), options);
  }

  /**
   * Creates a Deep Linking response with selected content items.
   */
  async createDeepLinkingResponse(
    contentItems: DeepLinkingContentItem[],
  ): Promise<LtiServiceResult<string>> {
    if (!contentItems) {
      throw new Error('contentItems is required');
    }

    if (!this.session.services?.deepLinking) {
      return ltiServicePreconditionFailure({
        code: 'service_not_available',
        serviceKind: 'deep_linking',
        operation: 'createDeepLinkingResponse',
        message: 'Deep Linking is not available for this session',
      });
    }

    return await runLtiServiceOperation({
      serviceKind: 'deep_linking',
      operation: 'createDeepLinkingResponse',
      execute: () =>
        this.services.deepLinkingService.createResponse(this.session, contentItems),
    });
  }

  /**
   * Creates an HTML Response that auto-submits selected Deep Linking content items.
   */
  async createDeepLinkingHtmlResponse(
    contentItems: DeepLinkingContentItem[],
  ): Promise<LtiServiceResult<Response>> {
    const result = await this.createDeepLinkingResponse(contentItems);
    if (!result.success) return result;

    return {
      success: true,
      data: new Response(result.data, {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/html; charset=utf-8',
        },
      }),
    };
  }

  private nrpsDeps(): LtiAdvantageNrpsDeps {
    return {
      session: this.session,
      nrpsService: this.services.nrpsService,
    };
  }

  private agsLineItemsDeps(): LtiAdvantageAgsLineItemsDeps {
    return {
      listLineItems: (
        options?: AGSListLineItemsOptions,
      ): Promise<LtiServiceResult<LineItems>> => this.listLineItems(options),
      listLineItemsAt: (url: string): Promise<LtiServiceResult<LineItems>> =>
        runAgsJsonOperation(this.session, {
          operation: 'listLineItems',
          scope: AGS_LINEITEM_READONLY_SCOPE,
          resolveUrl: () => url,
          parse: (data) => LineItemsSchema.parse(data),
          request: (requestUrl) =>
            this.services.agsService.listLineItems(this.session, requestUrl),
        }),
      createLineItem: (
        createLineItem: CreateLineItem,
      ): Promise<LtiServiceResult<LineItem>> => this.createLineItem(createLineItem),
    };
  }
}
