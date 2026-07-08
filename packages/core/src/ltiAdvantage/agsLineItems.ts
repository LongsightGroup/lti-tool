import { DEFAULT_LTI_SERVICE_MAX_PAGES } from '../constants.js';
import {
  LtiServiceError,
  ltiServicePreconditionFailure,
  type LtiServiceResult,
} from '../errors/ltiServiceError.js';
import {
  type CreateLineItem,
  type LineItem,
  type LineItems,
} from '../schemas/lti13/ags/lineItem.schema.js';
import type { AGSListLineItemsOptions } from '../services/ags.service.js';
import {
  matchesLtiAgsLineItemFilters,
  pickDeterministicLtiAgsLineItem,
  type LtiAgsLineItemFilters,
} from '../utils/ags.js';
import { followLtiPages, ltiPaginatedPageFromResponse } from '../utils/ltiPagination.js';

import type { FindMatchingLineItemResult, FindOrCreateLineItemInput } from './types.js';

export type LtiAdvantageAgsLineItemsDeps = {
  readonly listLineItems: (
    options?: AGSListLineItemsOptions,
  ) => Promise<LtiServiceResult<LineItems>>;
  readonly listLineItemsAt: (url: string) => Promise<LtiServiceResult<LineItems>>;
  readonly createLineItem: (
    createLineItem: CreateLineItem,
  ) => Promise<LtiServiceResult<LineItem>>;
};

export async function findMatchingLineItem(
  deps: LtiAdvantageAgsLineItemsDeps,
  filters: LtiAgsLineItemFilters,
): Promise<LtiServiceResult<FindMatchingLineItemResult>> {
  const matches: LineItem[] = [];

  const followed = await followLtiPages({
    maxPages: DEFAULT_LTI_SERVICE_MAX_PAGES,
    fetchPage: async (pageUrl) => {
      const listResult =
        pageUrl === undefined
          ? await deps.listLineItems({
              resourceId: filters.resourceId,
              resourceLinkId: filters.resourceLinkId,
              tag: filters.tag,
            })
          : await deps.listLineItemsAt(pageUrl);

      if (!listResult.success) return listResult;

      return {
        success: true,
        data: ltiPaginatedPageFromResponse(listResult.data, listResult.response),
      };
    },
    onPage: (page) => {
      matches.push(
        ...page.items.filter((lineItem) =>
          matchesLtiAgsLineItemFilters(lineItem, filters),
        ),
      );

      if (pickDeterministicLtiAgsLineItem(matches) !== undefined) {
        return 'stop';
      }
    },
  });

  if (!followed.success) return followed;

  return {
    success: true,
    data: {
      lineItem: pickDeterministicLtiAgsLineItem(matches),
      search: {
        truncated: followed.data.truncated,
        ...(followed.data.nextUrl === undefined
          ? {}
          : { nextUrl: followed.data.nextUrl }),
      },
    },
  };
}

function hasLineItemIdentity(filters: LtiAgsLineItemFilters): boolean {
  return (
    filters.resourceLinkId !== undefined ||
    filters.resourceId !== undefined ||
    filters.tag !== undefined
  );
}

function createContainsLineItemIdentity(input: FindOrCreateLineItemInput): boolean {
  return (
    input.create.resourceLinkId !== undefined ||
    input.create.resourceId !== undefined ||
    input.create.tag !== undefined
  );
}

function invalidFindOrCreateInput(message: string): LtiServiceResult<LineItem> {
  return ltiServicePreconditionFailure({
    code: 'invalid_request',
    serviceKind: 'ags',
    operation: 'findOrCreateLineItem',
    message,
  });
}

function createLineItemFromFindOrCreateInput(
  input: FindOrCreateLineItemInput,
  filters: LtiAgsLineItemFilters,
): CreateLineItem {
  return {
    ...input.create,
    ...(filters.resourceLinkId === undefined
      ? {}
      : { resourceLinkId: filters.resourceLinkId }),
    ...(filters.resourceId === undefined ? {} : { resourceId: filters.resourceId }),
    ...(filters.tag === undefined ? {} : { tag: filters.tag }),
  };
}

export async function findOrCreateLineItem(
  deps: LtiAdvantageAgsLineItemsDeps,
  input: FindOrCreateLineItemInput,
): Promise<LtiServiceResult<LineItem>> {
  const filters: LtiAgsLineItemFilters = {
    resourceLinkId: input.resourceLinkId,
    resourceId: input.resourceId,
    tag: input.tag,
  };

  if (!hasLineItemIdentity(filters)) {
    return invalidFindOrCreateInput(
      'At least one of resourceLinkId, resourceId, or tag is required',
    );
  }

  if (createContainsLineItemIdentity(input)) {
    return invalidFindOrCreateInput(
      'Line item identity fields must be supplied at the top level',
    );
  }

  const existing = await findMatchingLineItem(deps, filters);
  if (!existing.success) return existing;
  if (existing.data.lineItem !== undefined) {
    return { success: true, data: existing.data.lineItem };
  }
  if (existing.data.search.truncated) {
    return {
      success: false,
      error: new LtiServiceError({
        code: 'platform_request_failed',
        serviceKind: 'ags',
        operation: 'findOrCreateLineItem',
        message: 'Line item search was truncated before all pages were scanned',
      }),
    };
  }

  const created = await deps.createLineItem(
    createLineItemFromFindOrCreateInput(input, filters),
  );
  if (created.success) return created;

  const retry = await findMatchingLineItem(deps, filters);
  if (!retry.success) return created;
  if (retry.data.lineItem !== undefined) {
    return { success: true, data: retry.data.lineItem };
  }

  return created;
}
