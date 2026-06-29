import { describe, expect, it } from 'vitest';

import {
  LTI_ROLE_CONTEXT_INSTRUCTOR,
  LTI_ROLE_CONTEXT_LEARNER,
  getLtiMemberDisplayName,
  getLtiNrpsService,
  isLtiMemberInstructor,
  isLtiMemberLearner,
  isLtiNrpsAvailable,
  normalizeLtiNrpsMembersResponse,
  partitionLtiMembersByRoleKind,
  resolveLtiNrpsRoster,
  LTI_ROLE_CONTEXT_MEMBER,
  type LTISession,
} from '../src/index.js';

describe('NRPS helpers', () => {
  const session = {
    services: {
      nrps: {
        membershipUrl: 'https://platform.example.com/api/nrps/memberships',
        versions: ['2.0'],
      },
    },
  } as LTISession;

  it('reads NRPS service availability from sessions', () => {
    expect(isLtiNrpsAvailable(session)).toBe(true);
    expect(getLtiNrpsService(session)).toEqual({
      membershipUrl: 'https://platform.example.com/api/nrps/memberships',
      versions: ['2.0'],
    });
    expect(isLtiNrpsAvailable({ services: {} } as LTISession)).toBe(false);
  });

  it('normalizes NRPS membership responses to camelCase members', () => {
    const members = normalizeLtiNrpsMembersResponse({
      id: 'https://platform.example.com/api/nrps/memberships',
      context: { id: 'course-1' },
      members: [
        {
          status: 'Active',
          name: 'Ada Lovelace',
          given_name: 'Ada',
          family_name: 'Lovelace',
          email: 'ada@example.com',
          user_id: 'user-1',
          lis_person_sourcedid: 'sis-1',
          roles: [LTI_ROLE_CONTEXT_LEARNER],
        },
      ],
    });

    expect(members).toEqual([
      {
        status: 'Active',
        name: 'Ada Lovelace',
        givenName: 'Ada',
        familyName: 'Lovelace',
        email: 'ada@example.com',
        userId: 'user-1',
        lisPersonSourcedId: 'sis-1',
        roles: [LTI_ROLE_CONTEXT_LEARNER],
      },
    ]);
  });

  it('derives display names and checks member roles', () => {
    const members = normalizeLtiNrpsMembersResponse({
      id: 'https://platform.example.com/api/nrps/memberships',
      context: { id: 'course-1' },
      members: [
        {
          status: 'Active',
          name: 'Ada Lovelace',
          user_id: 'learner-1',
          roles: [LTI_ROLE_CONTEXT_LEARNER],
        },
        {
          status: 'Active',
          name: '',
          given_name: 'Grace',
          family_name: 'Hopper',
          user_id: 'instructor-1',
          roles: [LTI_ROLE_CONTEXT_INSTRUCTOR],
        },
      ],
    });

    const [learner, instructor] = members;
    if (!learner || !instructor) throw new Error('Expected two NRPS members');

    expect(getLtiMemberDisplayName(learner)).toBe('Ada Lovelace');
    expect(getLtiMemberDisplayName(instructor)).toBe('Grace Hopper');
    expect(isLtiMemberLearner(learner)).toBe(true);
    expect(isLtiMemberInstructor(instructor)).toBe(true);

    const partitioned = partitionLtiMembersByRoleKind(members, 'learner');
    expect(partitioned.matching.map((member) => member.userId)).toEqual(['learner-1']);
    expect(partitioned.rest.map((member) => member.userId)).toEqual(['instructor-1']);
  });

  it('resolves NRPS members into a roster-oriented shape', () => {
    const members = normalizeLtiNrpsMembersResponse({
      id: 'https://platform.example.com/api/nrps/memberships',
      context: { id: 'course-1' },
      members: [
        {
          status: 'Active',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          picture: 'https://platform.example.com/users/ada.png',
          user_id: 'learner-1',
          lis_person_sourcedid: 'sis-learner-1',
          roles: [LTI_ROLE_CONTEXT_LEARNER],
        },
        {
          status: 'Active',
          name: '',
          given_name: 'Grace',
          family_name: 'Hopper',
          user_id: 'dual-role-1',
          roles: [LTI_ROLE_CONTEXT_LEARNER, LTI_ROLE_CONTEXT_INSTRUCTOR],
        },
        {
          status: 'Active',
          name: 'Katherine Johnson',
          user_id: 'instructor-1',
          roles: [LTI_ROLE_CONTEXT_INSTRUCTOR],
        },
        {
          status: 'Inactive',
          name: 'Mary Jackson',
          user_id: 'member-1',
          roles: [LTI_ROLE_CONTEXT_MEMBER],
        },
      ],
    });

    const roster = resolveLtiNrpsRoster(members);

    expect(roster.members).toEqual([
      {
        userId: 'learner-1',
        displayName: 'Ada Lovelace',
        roles: [LTI_ROLE_CONTEXT_LEARNER],
        isLearner: true,
        isInstructor: false,
        status: 'Active',
        email: 'ada@example.com',
        picture: 'https://platform.example.com/users/ada.png',
        lisPersonSourcedId: 'sis-learner-1',
      },
      {
        userId: 'dual-role-1',
        displayName: 'Grace Hopper',
        roles: [LTI_ROLE_CONTEXT_LEARNER, LTI_ROLE_CONTEXT_INSTRUCTOR],
        isLearner: true,
        isInstructor: true,
        status: 'Active',
      },
      {
        userId: 'instructor-1',
        displayName: 'Katherine Johnson',
        roles: [LTI_ROLE_CONTEXT_INSTRUCTOR],
        isLearner: false,
        isInstructor: true,
        status: 'Active',
      },
      {
        userId: 'member-1',
        displayName: 'Mary Jackson',
        roles: [LTI_ROLE_CONTEXT_MEMBER],
        isLearner: false,
        isInstructor: false,
        status: 'Inactive',
      },
    ]);
    expect(roster.learnerMembers.map((member) => member.userId)).toEqual([
      'learner-1',
      'dual-role-1',
    ]);
    expect(roster.instructorMembers.map((member) => member.userId)).toEqual([
      'dual-role-1',
      'instructor-1',
    ]);
  });
});
