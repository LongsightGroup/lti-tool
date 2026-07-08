import type { CreateLineItem, LineItem } from '../schemas/lti13/ags/lineItem.schema.js';
import type { Member } from '../schemas/lti13/nrps/contextMembership.schema.js';

export type NrpsMembersPage = {
  readonly members: Member[];
  readonly nextUrl?: string;
  readonly differencesUrl?: string;
};

export type NrpsMembersPagination = {
  readonly pagesFetched: number;
  readonly truncated: boolean;
  readonly nextUrl?: string;
};

export type NrpsMembersResult = {
  readonly members: Member[];
  readonly pagination: NrpsMembersPagination;
};

export type NrpsGetMembersOptions =
  | { readonly followPagination?: false | undefined }
  | {
      /** When true, follows Link rel="next" pages up to maxPages. */
      readonly followPagination: true;
      /** Hard cap on pages fetched when followPagination is true. Defaults to 100. */
      readonly maxPages?: number;
    };

type LtiAgsLineItemIdentity =
  | {
      readonly resourceLinkId: string;
      readonly resourceId?: string;
      readonly tag?: string;
    }
  | {
      readonly resourceLinkId?: string;
      readonly resourceId: string;
      readonly tag?: string;
    }
  | {
      readonly resourceLinkId?: string;
      readonly resourceId?: string;
      readonly tag: string;
    };

type FindOrCreateLineItemCreate = {
  readonly [key: string]: unknown;
  readonly label: CreateLineItem['label'];
  readonly scoreMaximum: CreateLineItem['scoreMaximum'];
  readonly startDateTime?: CreateLineItem['startDateTime'];
  readonly endDateTime?: CreateLineItem['endDateTime'];
  readonly gradesReleased?: CreateLineItem['gradesReleased'];
  readonly resourceLinkId?: never;
  readonly resourceId?: never;
  readonly tag?: never;
};

export type FindOrCreateLineItemInput = LtiAgsLineItemIdentity & {
  readonly create: FindOrCreateLineItemCreate;
};

export type FindMatchingLineItemResult = {
  readonly lineItem?: LineItem;
  readonly search: {
    readonly truncated: boolean;
    readonly nextUrl?: string;
  };
};
