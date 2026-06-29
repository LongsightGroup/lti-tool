import type { LTISession } from '../interfaces/ltiSession.js';

import { getLtiAgsService } from './ags.js';
import { getLtiNrpsService } from './nrps.js';

/** Resolved Assignment and Grade Services capability metadata for an LTI session. */
export interface LtiAgsServiceCapabilities {
  /** True when the launch session includes an AGS service claim. */
  readonly available: boolean;
  /** Single line item endpoint URL, when provided by the platform. */
  readonly lineitem?: string;
  /** Line items collection endpoint URL, when provided by the platform. */
  readonly lineitems?: string;
  /** OAuth scopes advertised for AGS access. */
  readonly scopes: readonly string[];
}

/** Resolved Names and Role Provisioning Services capability metadata for an LTI session. */
export interface LtiNrpsServiceCapabilities {
  /** True when the launch session includes an NRPS service claim. */
  readonly available: boolean;
  /** Context membership endpoint URL, when provided by the platform. */
  readonly membershipUrl?: string;
  /** NRPS versions advertised by the platform. */
  readonly versions: readonly string[];
}

/** Resolved Deep Linking capability metadata for an LTI session. */
export interface LtiDeepLinkingServiceCapabilities {
  /** True when the launch session includes Deep Linking settings. */
  readonly available: boolean;
  /** Deep Linking return URL, when provided by the platform. */
  readonly returnUrl?: string;
  /** Content item types accepted by the platform. */
  readonly acceptTypes: readonly string[];
  /** Presentation targets accepted by the platform. */
  readonly acceptPresentationDocumentTargets: readonly string[];
  /** Optional accepted media type expression advertised by the platform. */
  readonly acceptMediaTypes?: string;
  /** Whether the platform accepts multiple returned content items. */
  readonly acceptMultiple: boolean;
  /** Whether the platform requests automatic item creation. */
  readonly autoCreate: boolean;
  /** Platform-specific opaque data that should be returned in the Deep Linking response. */
  readonly data?: string;
}

/** Policy-free snapshot of LTI Advantage service capabilities advertised in a launch session. */
export interface LtiServiceCapabilities {
  /** Assignment and Grade Services capability metadata. */
  readonly ags: LtiAgsServiceCapabilities;
  /** Names and Role Provisioning Services capability metadata. */
  readonly nrps: LtiNrpsServiceCapabilities;
  /** Deep Linking capability metadata. */
  readonly deepLinking: LtiDeepLinkingServiceCapabilities;
}

/**
 * Resolves a policy-free snapshot of LTI Advantage service capabilities from a launch session.
 *
 * The snapshot only interprets the session shape and copies collection fields for safe caller
 * projection. It does not apply HTTP, persistence, logging, or application policy.
 *
 * @param session - Active LTI session produced from a launch
 * @returns Normalized service capability metadata with empty arrays for absent list fields
 */
export function resolveLtiServiceCapabilities(
  session: LTISession,
): LtiServiceCapabilities {
  const agsService = getLtiAgsService(session);
  const nrpsService = getLtiNrpsService(session);
  const deepLinkingService = session.services?.deepLinking;

  return {
    ags: {
      available: agsService !== undefined,
      ...(agsService?.lineitem === undefined ? {} : { lineitem: agsService.lineitem }),
      ...(agsService?.lineitems === undefined ? {} : { lineitems: agsService.lineitems }),
      scopes: [...(agsService?.scopes ?? [])],
    },
    nrps: {
      available: nrpsService !== undefined,
      ...(nrpsService?.membershipUrl === undefined
        ? {}
        : { membershipUrl: nrpsService.membershipUrl }),
      versions: [...(nrpsService?.versions ?? [])],
    },
    deepLinking: {
      available: deepLinkingService !== undefined,
      ...(deepLinkingService?.returnUrl === undefined
        ? {}
        : { returnUrl: deepLinkingService.returnUrl }),
      acceptTypes: [...(deepLinkingService?.acceptTypes ?? [])],
      acceptPresentationDocumentTargets: [
        ...(deepLinkingService?.acceptPresentationDocumentTargets ?? []),
      ],
      ...(deepLinkingService?.acceptMediaTypes === undefined
        ? {}
        : { acceptMediaTypes: deepLinkingService.acceptMediaTypes }),
      acceptMultiple: deepLinkingService?.acceptMultiple ?? false,
      autoCreate: deepLinkingService?.autoCreate ?? false,
      ...(deepLinkingService?.data === undefined
        ? {}
        : { data: deepLinkingService.data }),
    },
  };
}
