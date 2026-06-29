import { describe, expect, it } from 'vitest';

import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_SCORE,
  resolveLtiServiceCapabilities,
  type LTISession,
} from '../src/index.js';

describe('LTI service capability helpers', () => {
  it('resolves advertised launch service capabilities', () => {
    const agsScopes = [LTI_AGS_SCOPE_LINEITEM, LTI_AGS_SCOPE_SCORE];
    const nrpsVersions = ['2.0'];
    const acceptTypes = ['ltiResourceLink', 'link'];
    const presentationTargets = ['iframe', 'window'];
    const session = {
      services: {
        ags: {
          lineitem: 'https://platform.example.com/ags/lineitems/1',
          lineitems: 'https://platform.example.com/ags/lineitems',
          scopes: agsScopes,
        },
        nrps: {
          membershipUrl: 'https://platform.example.com/nrps/members',
          versions: nrpsVersions,
        },
        deepLinking: {
          returnUrl: 'https://platform.example.com/deep-linking/return',
          acceptTypes,
          acceptPresentationDocumentTargets: presentationTargets,
          acceptMediaTypes: 'image/*,text/html',
          acceptMultiple: true,
          autoCreate: false,
          data: 'opaque-platform-data',
        },
      },
    } as LTISession;

    const capabilities = resolveLtiServiceCapabilities(session);

    expect(capabilities).toEqual({
      ags: {
        available: true,
        lineitem: 'https://platform.example.com/ags/lineitems/1',
        lineitems: 'https://platform.example.com/ags/lineitems',
        scopes: [LTI_AGS_SCOPE_LINEITEM, LTI_AGS_SCOPE_SCORE],
      },
      nrps: {
        available: true,
        membershipUrl: 'https://platform.example.com/nrps/members',
        versions: ['2.0'],
      },
      deepLinking: {
        available: true,
        returnUrl: 'https://platform.example.com/deep-linking/return',
        acceptTypes: ['ltiResourceLink', 'link'],
        acceptPresentationDocumentTargets: ['iframe', 'window'],
        acceptMediaTypes: 'image/*,text/html',
        acceptMultiple: true,
        autoCreate: false,
        data: 'opaque-platform-data',
      },
    });
    expect(capabilities.ags.scopes).not.toBe(agsScopes);
    expect(capabilities.nrps.versions).not.toBe(nrpsVersions);
    expect(capabilities.deepLinking.acceptTypes).not.toBe(acceptTypes);
    expect(capabilities.deepLinking.acceptPresentationDocumentTargets).not.toBe(
      presentationTargets,
    );
  });

  it('returns unavailable capability snapshots with empty collections when services are absent', () => {
    const capabilities = resolveLtiServiceCapabilities({ services: {} } as LTISession);

    expect(capabilities).toEqual({
      ags: {
        available: false,
        scopes: [],
      },
      nrps: {
        available: false,
        versions: [],
      },
      deepLinking: {
        available: false,
        acceptTypes: [],
        acceptPresentationDocumentTargets: [],
        acceptMultiple: false,
        autoCreate: false,
      },
    });
  });
});
