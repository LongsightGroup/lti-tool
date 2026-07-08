import { describe, expect, it } from 'vitest';

import type { LtiServiceResult } from '../src/index.js';
import { findOrCreateLineItem } from '../src/ltiAdvantage/agsLineItems.js';
import type { LineItem } from '../src/schemas/lti13/ags/lineItem.schema.js';

const lineItem: LineItem = {
  id: 'https://platform.example.com/ags/lineitems/1',
  label: 'Quiz 1',
  scoreMaximum: 10,
  resourceLinkId: 'resource-link-1',
};

const success = <T>(data: T, response?: Response): LtiServiceResult<T> => ({
  success: true,
  data,
  ...(response === undefined ? {} : { response }),
});

describe('findOrCreateLineItem', () => {
  it('does not trust first-page platform filters', async () => {
    const mismatchedLineItem: LineItem = {
      ...lineItem,
      id: 'https://platform.example.com/ags/lineitems/99',
      resourceLinkId: 'other-resource-link',
    };
    const createdLineItem: LineItem = {
      ...lineItem,
      id: 'https://platform.example.com/ags/lineitems/2',
    };

    const result = await findOrCreateLineItem(
      {
        listLineItems: () => Promise.resolve(success([mismatchedLineItem])),
        listLineItemsAt: () => Promise.resolve(success([])),
        createLineItem: () => Promise.resolve(success(createdLineItem)),
      },
      {
        resourceLinkId: 'resource-link-1',
        create: { label: 'Quiz 1', scoreMaximum: 10 },
      },
    );

    expect(result).toEqual({
      success: true,
      data: createdLineItem,
    });
  });

  it('fails when line item search is truncated before create', async () => {
    let createCalled = false;
    let pagesFetched = 0;
    const nextPageResponse = (page: number): Response =>
      new Response('[]', {
        headers: {
          Link: `<https://platform.example.com/ags/lineitems?page=${page}>; rel="next"`,
        },
      });

    const result = await findOrCreateLineItem(
      {
        listLineItems: () => {
          pagesFetched++;
          return Promise.resolve(success([], nextPageResponse(2)));
        },
        listLineItemsAt: () => {
          pagesFetched++;
          return Promise.resolve(success([], nextPageResponse(pagesFetched + 1)));
        },
        createLineItem: () => {
          createCalled = true;
          return Promise.resolve(success(lineItem));
        },
      },
      {
        resourceLinkId: 'resource-link-1',
        create: { label: 'Quiz 1', scoreMaximum: 10 },
      },
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected truncated search failure');
    expect(result.error).toMatchObject({
      code: 'platform_request_failed',
      operation: 'findOrCreateLineItem',
      message: 'Line item search was truncated before all pages were scanned',
    });
    expect(pagesFetched).toBe(100);
    expect(createCalled).toBe(false);
  });
});
