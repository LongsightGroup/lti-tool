import { describe, expect, it } from 'vitest';

import {
  LTI_CLAIM_CONTEXT,
  LTI_CLAIM_CUSTOM,
  LTI_CLAIM_DEEP_LINKING_SETTINGS,
  LTI_CLAIM_DEPLOYMENT_ID,
  LTI_CLAIM_MESSAGE_TYPE,
  LTI_CLAIM_RESOURCE_LINK,
  LTI_CLAIM_ROLES,
  LTI_CLAIM_TARGET_LINK_URI,
  LTI_CLAIM_VERSION,
  LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
  LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
  LTI_ROLE_CONTEXT_INSTRUCTOR,
  LTI_ROLE_CONTEXT_LEARNER,
  LTI_VERSION_1P3P0,
  LtiLaunchMessageResolutionError,
  resolveLtiLaunchMessage,
  type LTI13JwtPayload,
} from '../src/index.js';

describe('resolveLtiLaunchMessage', () => {
  const createPayload = (overrides: Partial<LTI13JwtPayload> = {}): LTI13JwtPayload =>
    ({
      iss: 'https://platform.example.com',
      aud: 'client123',
      sub: 'user123',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: 'nonce123',
      given_name: 'Test',
      family_name: 'User',
      name: 'Test User',
      email: 'test@example.com',
      [LTI_CLAIM_MESSAGE_TYPE]: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
      [LTI_CLAIM_VERSION]: LTI_VERSION_1P3P0,
      [LTI_CLAIM_DEPLOYMENT_ID]: 'deployment1',
      [LTI_CLAIM_TARGET_LINK_URI]: 'https://tool.example.com/launch',
      [LTI_CLAIM_ROLES]: [LTI_ROLE_CONTEXT_LEARNER],
      [LTI_CLAIM_RESOURCE_LINK]: {
        id: 'resource-1',
        title: 'Resource 1',
      },
      [LTI_CLAIM_CONTEXT]: {
        id: 'course-1',
        label: 'CS101',
      },
      ...overrides,
    }) as LTI13JwtPayload;

  it('resolves Resource Link launch messages', () => {
    const resolved = resolveLtiLaunchMessage(
      createPayload({
        [LTI_CLAIM_CUSTOM]: { badge_template_id: 'badge-1' },
      }),
    );

    expect(resolved).toMatchObject({
      kind: 'resource-link',
      issuer: 'https://platform.example.com',
      subject: 'user123',
      deploymentId: 'deployment1',
      targetLinkUri: 'https://tool.example.com/launch',
      roleKinds: ['learner'],
      simplifiedRoles: ['student'],
      context: {
        id: 'course-1',
        label: 'CS101',
      },
      customParameters: {
        badge_template_id: 'badge-1',
      },
      resourceLink: {
        id: 'resource-1',
        title: 'Resource 1',
      },
    });
  });

  it('resolves Deep Linking launch messages with normalized settings', () => {
    const resolved = resolveLtiLaunchMessage(
      createPayload({
        [LTI_CLAIM_MESSAGE_TYPE]: LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
        [LTI_CLAIM_ROLES]: [LTI_ROLE_CONTEXT_INSTRUCTOR],
        [LTI_CLAIM_RESOURCE_LINK]: undefined,
        [LTI_CLAIM_DEEP_LINKING_SETTINGS]: {
          deep_link_return_url: 'https://platform.example.com/deep_links',
          accept_types: ['ltiResourceLink'],
          accept_presentation_document_targets: ['iframe'],
        },
      }),
    );

    expect(resolved).toMatchObject({
      kind: 'deep-linking',
      roleKinds: ['instructor'],
      simplifiedRoles: ['instructor'],
      deepLinkingSettings: {
        returnUrl: 'https://platform.example.com/deep_links',
        acceptTypes: ['ltiResourceLink'],
        acceptPresentationDocumentTargets: ['iframe'],
        acceptMultiple: false,
        autoCreate: false,
      },
    });
  });

  it('throws a typed error when Resource Link messages omit resource_link.id', () => {
    expect(() =>
      resolveLtiLaunchMessage(
        createPayload({
          [LTI_CLAIM_RESOURCE_LINK]: undefined,
        }),
      ),
    ).toThrow(LtiLaunchMessageResolutionError);
  });

  it('throws a typed error when Deep Linking messages omit settings', () => {
    try {
      resolveLtiLaunchMessage(
        createPayload({
          [LTI_CLAIM_MESSAGE_TYPE]: LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
          [LTI_CLAIM_RESOURCE_LINK]: undefined,
        }),
      );
      throw new Error('Expected resolver to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(LtiLaunchMessageResolutionError);
      if (error instanceof LtiLaunchMessageResolutionError) {
        expect(error.code).toBe('missing_deep_linking_settings');
      }
    }
  });
});
