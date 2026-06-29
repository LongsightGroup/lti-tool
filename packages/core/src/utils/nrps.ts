import type { LTISession } from '../interfaces/ltiSession.js';
import {
  NRPSContextMembershipResponseSchema,
  type Member,
} from '../schemas/lti13/nrps/contextMembership.schema.js';

import {
  hasLtiAdministratorRole,
  hasLtiContentDeveloperRole,
  hasLtiInstructorRole,
  hasLtiLearnerRole,
  hasLtiRoleKind,
  type LtiRoleKind,
} from './ltiRoles.js';

export type LtiNrpsService = NonNullable<NonNullable<LTISession['services']>['nrps']>;

export interface ResolvedLtiNrpsRosterMember {
  userId: string;
  displayName: string;
  roles: string[];
  isLearner: boolean;
  isInstructor: boolean;
  status: Member['status'];
  email?: string;
  picture?: string;
  lisPersonSourcedId?: string;
}

export interface ResolvedLtiNrpsRoster {
  members: ResolvedLtiNrpsRosterMember[];
  learnerMembers: ResolvedLtiNrpsRosterMember[];
  instructorMembers: ResolvedLtiNrpsRosterMember[];
}

export function getLtiNrpsService(session: LTISession): LtiNrpsService | undefined {
  return session.services?.nrps;
}

export function isLtiNrpsAvailable(session: LTISession): boolean {
  return getLtiNrpsService(session) !== undefined;
}

export function normalizeLtiNrpsMembersResponse(input: unknown): Member[] {
  const response = NRPSContextMembershipResponseSchema.parse(input);
  return response.members.map((member) => ({
    status: member.status,
    name: member.name,
    ...(member.picture === undefined ? {} : { picture: member.picture }),
    ...(member.given_name === undefined ? {} : { givenName: member.given_name }),
    ...(member.family_name === undefined ? {} : { familyName: member.family_name }),
    ...(member.middle_name === undefined ? {} : { middleName: member.middle_name }),
    ...(member.email === undefined ? {} : { email: member.email }),
    userId: member.user_id,
    ...(member.lis_person_sourcedid === undefined
      ? {}
      : { lisPersonSourcedId: member.lis_person_sourcedid }),
    roles: member.roles,
  }));
}

export function getLtiMemberDisplayName(member: Member): string {
  if (member.name.trim().length > 0) return member.name;

  const nameParts = [member.givenName, member.middleName, member.familyName].filter(
    (part): part is string => part !== undefined && part.trim().length > 0,
  );
  if (nameParts.length > 0) return nameParts.join(' ');

  return member.email ?? member.userId;
}

export function hasLtiMemberRoleKind(
  member: Member,
  roleKind: Exclude<LtiRoleKind, 'unknown'>,
): boolean {
  return hasLtiRoleKind(member.roles, roleKind);
}

export function isLtiMemberAdministrator(member: Member): boolean {
  return hasLtiAdministratorRole(member.roles);
}

export function isLtiMemberContentDeveloper(member: Member): boolean {
  return hasLtiContentDeveloperRole(member.roles);
}

export function isLtiMemberInstructor(member: Member): boolean {
  return hasLtiInstructorRole(member.roles);
}

export function isLtiMemberLearner(member: Member): boolean {
  return hasLtiLearnerRole(member.roles);
}

export function partitionLtiMembersByRoleKind(
  members: readonly Member[],
  roleKind: Exclude<LtiRoleKind, 'unknown'>,
): { matching: Member[]; rest: Member[] } {
  const matching: Member[] = [];
  const rest: Member[] = [];

  for (const member of members) {
    if (hasLtiMemberRoleKind(member, roleKind)) {
      matching.push(member);
    } else {
      rest.push(member);
    }
  }

  return { matching, rest };
}

export function resolveLtiNrpsRoster(members: readonly Member[]): ResolvedLtiNrpsRoster {
  const resolvedMembers = members.map((member) => {
    const resolvedMember: ResolvedLtiNrpsRosterMember = {
      userId: member.userId,
      displayName: getLtiMemberDisplayName(member),
      roles: [...member.roles],
      isLearner: isLtiMemberLearner(member),
      isInstructor: isLtiMemberInstructor(member),
      status: member.status,
      ...(member.email === undefined ? {} : { email: member.email }),
      ...(member.picture === undefined ? {} : { picture: member.picture }),
      ...(member.lisPersonSourcedId === undefined
        ? {}
        : { lisPersonSourcedId: member.lisPersonSourcedId }),
    };

    return resolvedMember;
  });

  return {
    members: resolvedMembers,
    learnerMembers: resolvedMembers.filter((member) => member.isLearner),
    instructorMembers: resolvedMembers.filter((member) => member.isInstructor),
  };
}
