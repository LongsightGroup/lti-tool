import { describe, expect, it } from 'vitest';

import {
  LTI_ROLE_CONTEXT_CONTENT_DEVELOPER,
  LTI_ROLE_CONTEXT_INSTRUCTOR,
  LTI_ROLE_CONTEXT_LEARNER,
  LTI_ROLE_CONTEXT_TEACHING_ASSISTANT,
  LTI_ROLE_INSTITUTION_ADMINISTRATOR,
  classifyLtiRole,
  classifyLtiRoles,
  getLtiRoleName,
  hasLtiAdministratorRole,
  hasLtiContentDeveloperRole,
  hasLtiInstructorRole,
  hasLtiLearnerRole,
  simplifyLtiRoles,
} from '../src/index.js';

describe('LTI role helpers', () => {
  it('extracts role names from standard role URIs', () => {
    expect(getLtiRoleName(LTI_ROLE_CONTEXT_INSTRUCTOR)).toBe('Instructor');
    expect(getLtiRoleName('Instructor')).toBe('Instructor');
  });

  it('classifies common context and institution roles', () => {
    expect(classifyLtiRole(LTI_ROLE_CONTEXT_INSTRUCTOR)).toBe('instructor');
    expect(classifyLtiRole(LTI_ROLE_CONTEXT_TEACHING_ASSISTANT)).toBe('instructor');
    expect(classifyLtiRole(LTI_ROLE_CONTEXT_LEARNER)).toBe('learner');
    expect(classifyLtiRole(LTI_ROLE_INSTITUTION_ADMINISTRATOR)).toBe('administrator');
    expect(classifyLtiRole('http://example.com/custom#Observer')).toBe('unknown');
  });

  it('deduplicates classified and simplified roles while preserving first-seen order', () => {
    const roles = [
      LTI_ROLE_CONTEXT_INSTRUCTOR,
      LTI_ROLE_CONTEXT_TEACHING_ASSISTANT,
      LTI_ROLE_CONTEXT_CONTENT_DEVELOPER,
      LTI_ROLE_CONTEXT_LEARNER,
      LTI_ROLE_CONTEXT_LEARNER,
    ];

    expect(classifyLtiRoles(roles)).toEqual([
      'instructor',
      'content-developer',
      'learner',
    ]);
    expect(simplifyLtiRoles(roles)).toEqual([
      'instructor',
      'content-developer',
      'student',
    ]);
  });

  it('checks role families without callers parsing URIs', () => {
    const roles = [
      LTI_ROLE_CONTEXT_CONTENT_DEVELOPER,
      LTI_ROLE_INSTITUTION_ADMINISTRATOR,
    ];

    expect(hasLtiAdministratorRole(roles)).toBe(true);
    expect(hasLtiContentDeveloperRole(roles)).toBe(true);
    expect(hasLtiInstructorRole(roles)).toBe(false);
    expect(hasLtiLearnerRole(roles)).toBe(false);
  });
});
