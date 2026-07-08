import { describe, expect, it } from 'vitest';

import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_RESULT_READONLY,
  getLtiAgsService,
  hasLtiAgsScope,
  isLtiAgsAvailable,
  isLtiAgsLineItemAvailable,
  isLtiAgsLineItemsAvailable,
  type LTISession,
} from '../src/index.js';
import {
  matchesLtiAgsLineItemFilters,
  pickDeterministicLtiAgsLineItem,
} from '../src/utils/ags.js';

describe('AGS helpers', () => {
  const session = {
    services: {
      ags: {
        lineitem: 'https://platform.example.com/ags/lineitems/1',
        lineitems: 'https://platform.example.com/ags/lineitems',
        scopes: [LTI_AGS_SCOPE_LINEITEM, LTI_AGS_SCOPE_RESULT_READONLY],
      },
    },
  } as LTISession;

  it('reads AGS service availability from sessions', () => {
    expect(isLtiAgsAvailable(session)).toBe(true);
    expect(getLtiAgsService(session)).toEqual({
      lineitem: 'https://platform.example.com/ags/lineitems/1',
      lineitems: 'https://platform.example.com/ags/lineitems',
      scopes: [LTI_AGS_SCOPE_LINEITEM, LTI_AGS_SCOPE_RESULT_READONLY],
    });
    expect(isLtiAgsAvailable({ services: {} } as LTISession)).toBe(false);
  });

  it('checks AGS line item endpoint availability', () => {
    expect(isLtiAgsLineItemAvailable(session)).toBe(true);
    expect(isLtiAgsLineItemsAvailable(session)).toBe(true);
    expect(
      isLtiAgsLineItemAvailable({
        services: {
          ags: { lineitems: 'https://platform.example.com/lineitems', scopes: [] },
        },
      } as unknown as LTISession),
    ).toBe(false);
  });

  it('checks AGS scopes', () => {
    expect(hasLtiAgsScope(session, LTI_AGS_SCOPE_LINEITEM)).toBe(true);
    expect(
      hasLtiAgsScope(session, 'https://purl.imsglobal.org/spec/lti-ags/scope/score'),
    ).toBe(false);
  });

  it('matches line items on provided identity keys only', () => {
    const lineItem = {
      id: 'https://platform.example.com/ags/lineitems/2',
      resourceLinkId: 'link-1',
      resourceId: 'resource-1',
      tag: 'quiz',
    };

    expect(
      matchesLtiAgsLineItemFilters(lineItem, {
        resourceLinkId: 'link-1',
        tag: 'quiz',
      }),
    ).toBe(true);
    expect(
      matchesLtiAgsLineItemFilters(lineItem, {
        resourceLinkId: 'link-2',
      }),
    ).toBe(false);
  });

  it('picks the first line item by id', () => {
    expect(
      pickDeterministicLtiAgsLineItem([
        { id: 'https://platform.example.com/ags/lineitems/2' },
        { id: 'https://platform.example.com/ags/lineitems/1' },
      ])?.id,
    ).toBe('https://platform.example.com/ags/lineitems/1');
  });
});
