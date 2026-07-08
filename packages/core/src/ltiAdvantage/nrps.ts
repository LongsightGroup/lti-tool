import { DEFAULT_LTI_SERVICE_MAX_PAGES } from '../constants.js';
import {
  ltiServicePreconditionFailure,
  runLtiServiceCall,
  type LtiServiceResult,
} from '../errors/ltiServiceError.js';
import type { LTISession } from '../interfaces/ltiSession.js';
import type { Member } from '../schemas/lti13/nrps/contextMembership.schema.js';
import type { NRPSService } from '../services/nrps.service.js';
import { followLtiPages, ltiPaginatedPageFromResponse } from '../utils/ltiPagination.js';
import { normalizeLtiNrpsMembersResponse } from '../utils/nrps.js';

import { requireNrpsMembership } from './shared.js';
import type {
  NrpsGetMembersOptions,
  NrpsMembersPage,
  NrpsMembersResult,
} from './types.js';

export type LtiAdvantageNrpsDeps = {
  readonly session: LTISession;
  readonly nrpsService: NRPSService;
};

export async function fetchNrpsMembersPage(
  deps: LtiAdvantageNrpsDeps,
  input: {
    pageUrl?: string;
    operation: string;
  },
): Promise<LtiServiceResult<NrpsMembersPage>> {
  const membershipUrl =
    input.pageUrl ??
    requireNrpsMembership<NrpsMembersPage>(deps.session, input.operation);
  if (typeof membershipUrl !== 'string') return membershipUrl;

  const pageResult = await runLtiServiceCall({
    serviceKind: 'nrps',
    operation: input.operation,
    request: () => deps.nrpsService.getMembers(deps.session, membershipUrl),
    responseBody: 'json',
    parse: (data) => normalizeLtiNrpsMembersResponse(data),
  });

  if (!pageResult.success) return pageResult;

  const page = ltiPaginatedPageFromResponse(pageResult.data, pageResult.response);

  return {
    success: true,
    data: {
      members: page.items,
      ...(page.nextUrl === undefined ? {} : { nextUrl: page.nextUrl }),
      ...(page.differencesUrl === undefined
        ? {}
        : { differencesUrl: page.differencesUrl }),
    },
    ...(pageResult.response === undefined ? {} : { response: pageResult.response }),
  };
}

export function getNrpsMembersPage(
  deps: LtiAdvantageNrpsDeps,
  pageUrl?: string,
): Promise<LtiServiceResult<NrpsMembersPage>> {
  return fetchNrpsMembersPage(deps, {
    pageUrl,
    operation: 'getMembersPage',
  });
}

async function followNrpsMembersPages(
  deps: LtiAdvantageNrpsDeps,
  maxPages: number,
): Promise<LtiServiceResult<NrpsMembersResult>> {
  const followed = await followLtiPages({
    maxPages,
    fetchPage: async (pageUrl) => {
      const pageResult = await fetchNrpsMembersPage(deps, {
        pageUrl,
        operation: 'getMembers',
      });
      if (!pageResult.success) return pageResult;

      return {
        success: true,
        data: {
          items: pageResult.data.members,
          ...(pageResult.data.nextUrl === undefined
            ? {}
            : { nextUrl: pageResult.data.nextUrl }),
          ...(pageResult.data.differencesUrl === undefined
            ? {}
            : { differencesUrl: pageResult.data.differencesUrl }),
        },
      };
    },
  });

  if (!followed.success) return followed;

  return {
    success: true,
    data: {
      members: followed.data.items,
      pagination: {
        pagesFetched: followed.data.pagesFetched,
        truncated: followed.data.truncated,
        ...(followed.data.nextUrl === undefined
          ? {}
          : { nextUrl: followed.data.nextUrl }),
      },
    },
  };
}

export async function getNrpsMembers(
  deps: LtiAdvantageNrpsDeps,
  options: NrpsGetMembersOptions = {},
): Promise<LtiServiceResult<Member[] | NrpsMembersResult>> {
  if (!options.followPagination) {
    const pageResult = await fetchNrpsMembersPage(deps, { operation: 'getMembers' });
    if (!pageResult.success) return pageResult;
    return { success: true, data: pageResult.data.members };
  }

  const maxPages = options.maxPages ?? DEFAULT_LTI_SERVICE_MAX_PAGES;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    return ltiServicePreconditionFailure({
      code: 'invalid_request',
      serviceKind: 'nrps',
      operation: 'getMembers',
      message: 'maxPages must be a positive integer',
    });
  }

  return followNrpsMembersPages(deps, maxPages);
}
