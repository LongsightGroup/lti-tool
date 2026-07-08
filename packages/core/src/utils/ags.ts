import type { LTISession } from '../interfaces/ltiSession.js';

export type LtiAgsService = NonNullable<NonNullable<LTISession['services']>['ags']>;

export function getLtiAgsService(session: LTISession): LtiAgsService | undefined {
  return session.services?.ags;
}

export function isLtiAgsAvailable(session: LTISession): boolean {
  return getLtiAgsService(session) !== undefined;
}

export function isLtiAgsLineItemAvailable(session: LTISession): boolean {
  return getLtiAgsService(session)?.lineitem !== undefined;
}

export function isLtiAgsLineItemsAvailable(session: LTISession): boolean {
  return getLtiAgsService(session)?.lineitems !== undefined;
}

export function hasLtiAgsScope(session: LTISession, scope: string): boolean {
  return getLtiAgsService(session)?.scopes.includes(scope) ?? false;
}

export type LtiAgsLineItemFilters = {
  readonly resourceLinkId?: string;
  readonly resourceId?: string;
  readonly tag?: string;
};

export function matchesLtiAgsLineItemFilters(
  lineItem: { resourceLinkId?: string; resourceId?: string; tag?: string },
  filters: LtiAgsLineItemFilters,
): boolean {
  if (
    filters.resourceLinkId !== undefined &&
    lineItem.resourceLinkId !== filters.resourceLinkId
  ) {
    return false;
  }
  if (filters.resourceId !== undefined && lineItem.resourceId !== filters.resourceId) {
    return false;
  }
  if (filters.tag !== undefined && lineItem.tag !== filters.tag) {
    return false;
  }

  return true;
}

export function pickDeterministicLtiAgsLineItem<TLineItem extends { id: string }>(
  lineItems: readonly TLineItem[],
): TLineItem | undefined {
  if (lineItems.length === 0) return undefined;

  return [...lineItems].sort((left, right) => left.id.localeCompare(right.id))[0];
}
