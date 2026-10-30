import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_SCORE,
  LTI_AGS_SCOPE_LINEITEM_READONLY,
} from '@longsightgroup/lti-tool';
import { describe, expect, it } from 'vitest';

import { testSession } from '#test-harness/fixtures';

import { scoreSubmissionAvailability } from '../src/grading.js';

describe('launch score submission capability', () => {
  const ags = {
    lineitem: 'https://lms.test/lineitems/1',
    scopes: [LTI_AGS_SCOPE_SCORE, LTI_AGS_SCOPE_LINEITEM_READONLY],
  };

  it('allows an ordinary grade-enabled launch without a custom activity parameter', () => {
    expect(scoreSubmissionAvailability(testSession({ services: { ags } }))).toEqual({
      available: true,
    });
  });

  it('allows full line-item permission to read the linked column', () => {
    expect(
      scoreSubmissionAvailability(
        testSession({
          services: {
            ags: { ...ags, scopes: [LTI_AGS_SCOPE_SCORE, LTI_AGS_SCOPE_LINEITEM] },
          },
        }),
      ),
    ).toEqual({ available: true });
    expect(
      scoreSubmissionAvailability(
        testSession({ services: { ags: { ...ags, scopes: [LTI_AGS_SCOPE_LINEITEM] } } }),
      ),
    ).toMatchObject({ available: false, code: 'missing_required_scope' });
  });

  it('explains a missing linked gradebook column even if a collection exists', () => {
    const session = testSession({
      services: {
        ags: { lineitems: 'https://lms.test/lineitems', scopes: [LTI_AGS_SCOPE_SCORE] },
      },
    });
    expect(scoreSubmissionAvailability(session)).toMatchObject({
      available: false,
      code: 'service_not_available',
      guidance: expect.stringContaining('linked gradebook column'),
    });
  });

  it('requires the explicit AGS score permission', () => {
    const session = testSession({ services: { ags: { ...ags, scopes: [] } } });
    expect(scoreSubmissionAvailability(session)).toMatchObject({
      available: false,
      code: 'missing_required_scope',
    });
  });

  it('requires read access to match the LMS column maximum without rescaling game points', () => {
    const session = testSession({
      services: { ags: { ...ags, scopes: [LTI_AGS_SCOPE_SCORE] } },
    });
    expect(scoreSubmissionAvailability(session)).toMatchObject({
      available: false,
      code: 'missing_required_scope',
      guidance: expect.stringContaining('lineitem.readonly'),
    });
  });

  it('requires the launch user to have an identifier', () => {
    const session = testSession({ user: { roles: [] }, services: { ags } });
    expect(scoreSubmissionAvailability(session)).toMatchObject({
      available: false,
      code: 'user_identifier_required',
    });
  });
});
