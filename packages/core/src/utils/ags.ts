import { LTI_AGS_SCOPE_LINEITEM, LTI_AGS_SCOPE_LINEITEM_READONLY } from '../constants.js';
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

/** Resolve a declared scope for an operation; full line-item permission also allows reads. */
export function resolveLtiAgsScope(
  scopes: readonly string[],
  required: string,
): string | undefined {
  if (scopes.includes(required)) return required;
  if (
    required === LTI_AGS_SCOPE_LINEITEM_READONLY &&
    scopes.includes(LTI_AGS_SCOPE_LINEITEM)
  )
    return LTI_AGS_SCOPE_LINEITEM;
  return undefined;
}

export function hasLtiAgsScope(session: LTISession, scope: string): boolean {
  return resolveLtiAgsScope(getLtiAgsService(session)?.scopes ?? [], scope) !== undefined;
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
