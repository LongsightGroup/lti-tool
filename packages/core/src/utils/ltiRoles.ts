export type LtiRoleKind =
  | 'administrator'
  | 'content-developer'
  | 'instructor'
  | 'learner'
  | 'member'
  | 'unknown';

export type LtiSimplifiedRole =
  | 'admin'
  | 'content-developer'
  | 'instructor'
  | 'member'
  | 'student';

const ROLE_KIND_BY_NAME = {
  Administrator: 'administrator',
  ContentDeveloper: 'content-developer',
  Instructor: 'instructor',
  Learner: 'learner',
  Member: 'member',
  TeachingAssistant: 'instructor',
} as const satisfies Record<string, LtiRoleKind>;

const SIMPLIFIED_ROLE_BY_KIND = {
  administrator: 'admin',
  'content-developer': 'content-developer',
  instructor: 'instructor',
  learner: 'student',
  member: 'member',
  unknown: undefined,
} as const satisfies Record<LtiRoleKind, LtiSimplifiedRole | undefined>;

export function getLtiRoleName(role: string): string {
  const fragmentIndex = role.lastIndexOf('#');
  if (fragmentIndex >= 0) return role.slice(fragmentIndex + 1);

  const pathIndex = role.lastIndexOf('/');
  if (pathIndex >= 0) return role.slice(pathIndex + 1);

  return role;
}

export function classifyLtiRole(role: string): LtiRoleKind {
  const roleName = getLtiRoleName(role);
  return ROLE_KIND_BY_NAME[roleName as keyof typeof ROLE_KIND_BY_NAME] ?? 'unknown';
}

export function classifyLtiRoles(roles: readonly string[]): LtiRoleKind[] {
  return unique(roles.map((role) => classifyLtiRole(role)));
}

export function simplifyLtiRoles(roles: readonly string[]): LtiSimplifiedRole[] {
  const simplified = roles
    .map((role) => SIMPLIFIED_ROLE_BY_KIND[classifyLtiRole(role)])
    .filter((role): role is LtiSimplifiedRole => role !== undefined);

  return unique(simplified);
}

export function hasLtiRoleKind(
  roles: readonly string[],
  roleKind: Exclude<LtiRoleKind, 'unknown'>,
): boolean {
  return roles.some((role) => classifyLtiRole(role) === roleKind);
}

export function hasLtiAdministratorRole(roles: readonly string[]): boolean {
  return hasLtiRoleKind(roles, 'administrator');
}

export function hasLtiContentDeveloperRole(roles: readonly string[]): boolean {
  return hasLtiRoleKind(roles, 'content-developer');
}

export function hasLtiInstructorRole(roles: readonly string[]): boolean {
  return hasLtiRoleKind(roles, 'instructor');
}

export function hasLtiLearnerRole(roles: readonly string[]): boolean {
  return hasLtiRoleKind(roles, 'learner');
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
