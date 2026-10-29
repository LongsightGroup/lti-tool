import { expect, it } from 'vitest';

import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_LINEITEM_READONLY,
  LTI_CLAIM_DEPLOYMENT_ID,
  LTI_CLAIM_MESSAGE_TYPE,
  LTI_CLAIM_RESOURCE_LINK,
  LTI_CLAIM_TARGET_LINK_URI,
  LTI_CLAIM_VERSION,
  LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
  LTI_VERSION_1P3P0,
  getLtiMemberDisplayName,
  hasLtiAgsScope,
  normalizeLtiNrpsMembersResponse,
  type LTISession,
} from '../src/index.js';
import { LTI13JwtPayloadSchema } from '../src/schemas/lti13/lti13JwtPayload.schema.js';
import { resolveLtiAgsScope } from '../src/utils/ags.js';

function session(scopes: string[]): LTISession {
  return {
    id: 'test-session',
    jwtPayload: LTI13JwtPayloadSchema.parse({
      iss: 'https://platform.example',
      aud: 'client',
      sub: 'member',
      exp: 4102444800,
      iat: 1793220000,
      nonce: 'test-nonce',
      [LTI_CLAIM_MESSAGE_TYPE]: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
      [LTI_CLAIM_VERSION]: LTI_VERSION_1P3P0,
      [LTI_CLAIM_DEPLOYMENT_ID]: 'deployment',
      [LTI_CLAIM_TARGET_LINK_URI]: 'https://tool.example/launch',
      [LTI_CLAIM_RESOURCE_LINK]: { id: 'resource' },
    }),
    user: { id: 'member', roles: [] },
    context: { id: 'course', label: 'COURSE', title: 'Course' },
    platform: {
      issuer: 'https://platform.example',
      clientId: 'client',
      deploymentId: 'deployment',
      name: 'Platform',
    },
    launch: { target: 'https://tool.example/launch' },
    customParameters: {},
    isAdmin: false,
    isInstructor: true,
    isStudent: false,
    isAssignmentAndGradesAvailable: true,
    isDeepLinkingAvailable: false,
    isNameAndRolesAvailable: false,
    services: { ags: { lineitems: 'https://platform.example/lineitems', scopes } },
  };
}

it('accepts an anonymous roster without inventing a member name', () => {
  const members = normalizeLtiNrpsMembersResponse({
    id: 'https://platform.example/roster',
    context: { id: 'course' },
    members: [{ status: 'Active', user_id: 'anonymous-member', roles: ['Learner'] }],
  });
  expect(members).toEqual([
    { status: 'Active', userId: 'anonymous-member', roles: ['Learner'] },
  ]);
  const member = members[0];
  if (!member) throw new Error('Missing parsed member');
  expect(getLtiMemberDisplayName(member)).toBe('anonymous-member');
});

it('allows a line-item read with the granted full scope but never permits writes with read-only scope', () => {
  expect(
    hasLtiAgsScope(session([LTI_AGS_SCOPE_LINEITEM]), LTI_AGS_SCOPE_LINEITEM_READONLY),
  ).toBe(true);
  expect(
    hasLtiAgsScope(session([LTI_AGS_SCOPE_LINEITEM_READONLY]), LTI_AGS_SCOPE_LINEITEM),
  ).toBe(false);
});

it('requests only a granted AGS read scope and prefers read-only when both are present', () => {
  expect(
    resolveLtiAgsScope([LTI_AGS_SCOPE_LINEITEM], LTI_AGS_SCOPE_LINEITEM_READONLY),
  ).toBe(LTI_AGS_SCOPE_LINEITEM);
  expect(
    resolveLtiAgsScope(
      [LTI_AGS_SCOPE_LINEITEM, LTI_AGS_SCOPE_LINEITEM_READONLY],
      LTI_AGS_SCOPE_LINEITEM_READONLY,
    ),
  ).toBe(LTI_AGS_SCOPE_LINEITEM_READONLY);
  expect(
    resolveLtiAgsScope([LTI_AGS_SCOPE_LINEITEM_READONLY], LTI_AGS_SCOPE_LINEITEM),
  ).toBeUndefined();
  expect(resolveLtiAgsScope([], LTI_AGS_SCOPE_LINEITEM_READONLY)).toBeUndefined();
});
