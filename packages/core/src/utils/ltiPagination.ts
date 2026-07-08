import type { LtiServiceResult } from '../errors/ltiServiceError.js';

import { parseLinkHeader } from './linkHeader.js';

export type LtiPaginatedPage<TItem> = {
  readonly items: TItem[];
  readonly nextUrl?: string;
  readonly differencesUrl?: string;
};

export type LtiFollowedPagesResult<TItem> = {
  readonly items: TItem[];
  readonly pagesFetched: number;
  readonly truncated: boolean;
  readonly nextUrl?: string;
};

export function ltiPaginatedPageFromResponse<TItem>(
  items: TItem[],
  response?: Response,
): LtiPaginatedPage<TItem> {
  const links = parseLinkHeader(response?.headers.get('Link'));

  return {
    items,
    ...(links.next === undefined ? {} : { nextUrl: links.next }),
    ...(links.differences === undefined ? {} : { differencesUrl: links.differences }),
  };
}

/**
 * Follows LTI platform Link rel="next" pages up to maxPages.
 */
export async function followLtiPages<TItem>(input: {
  maxPages: number;
  fetchPage: (pageUrl?: string) => Promise<LtiServiceResult<LtiPaginatedPage<TItem>>>;
  onPage?: (page: LtiPaginatedPage<TItem>, pagesFetched: number) => void | 'stop';
}): Promise<LtiServiceResult<LtiFollowedPagesResult<TItem>>> {
  const items: TItem[] = [];
  let pageUrl: string | undefined;
  let pagesFetched = 0;
  let nextUrl: string | undefined;

  while (pagesFetched < input.maxPages) {
    const pageResult = await input.fetchPage(pageUrl);
    if (!pageResult.success) return pageResult;

    pagesFetched++;
    items.push(...pageResult.data.items);
    nextUrl = pageResult.data.nextUrl;

    if (input.onPage?.(pageResult.data, pagesFetched) === 'stop') {
      return {
        success: true,
        data: {
          items,
          pagesFetched,
          truncated: false,
        },
      };
    }

    if (nextUrl === undefined) {
      return {
        success: true,
        data: {
          items,
          pagesFetched,
          truncated: false,
        },
      };
    }

    pageUrl = nextUrl;
  }

  return {
    success: true,
    data: {
      items,
      pagesFetched,
      truncated: true,
      nextUrl,
    },
  };
}
