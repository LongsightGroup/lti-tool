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
} from '../constants.js';
import type { LtiDeepLinkingSettings } from '../interfaces/ltiDeepLinkingSettings.js';
import type { LTISession } from '../interfaces/ltiSession.js';
import {
  LTI13JwtPayloadSchema,
  type LTI13JwtPayload,
} from '../schemas/lti13/lti13JwtPayload.schema.js';

import { parseLtiDeepLinkingSettings } from './deepLinkingSettings.js';
import { classifyLtiRoles, simplifyLtiRoles, type LtiRoleKind } from './ltiRoles.js';

export type LtiLaunchMessageResolutionErrorCode =
  | 'missing_deep_linking_settings'
  | 'missing_resource_link'
  | 'unsupported_message_type';

export class LtiLaunchMessageResolutionError extends Error {
  constructor(
    public readonly code: LtiLaunchMessageResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LtiLaunchMessageResolutionError';
  }
}

interface ResolvedLtiLaunchMessageBase {
  issuer: string;
  audience: string | string[];
  deploymentId: string;
  messageType: string;
  targetLinkUri: string;
  version: string;
  roles: string[];
  roleKinds: LtiRoleKind[];
  simplifiedRoles: string[];
  context?: {
    id: string;
    label?: string;
    title?: string;
  };
  customParameters: Record<string, string>;
}

export interface ResolvedLtiResourceLinkLaunchMessage extends ResolvedLtiLaunchMessageBase {
  kind: 'resource-link';
  messageType: typeof LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST;
  subject: string;
  resourceLink: {
    id: string;
    title?: string;
  };
}

export interface ResolvedLtiDeepLinkingLaunchMessage extends ResolvedLtiLaunchMessageBase {
  kind: 'deep-linking';
  messageType: typeof LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST;
  subject?: string;
  deepLinkingSettings: LtiDeepLinkingSettings;
}

export type ResolvedLtiLaunchMessage =
  | ResolvedLtiDeepLinkingLaunchMessage
  | ResolvedLtiResourceLinkLaunchMessage;

export function resolveLtiLaunchMessage(
  input: LTI13JwtPayload | LTISession,
): ResolvedLtiLaunchMessage {
  const payload = getPayload(input);
  const base = resolveBaseLaunchMessage(payload);
  const messageType = payload[LTI_CLAIM_MESSAGE_TYPE];

  if (messageType === LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST) {
    const resourceLink = payload[LTI_CLAIM_RESOURCE_LINK];
    if (!resourceLink?.id) {
      throw new LtiLaunchMessageResolutionError(
        'missing_resource_link',
        'LtiResourceLinkRequest requires resource_link.id',
      );
    }

    return {
      ...base,
      kind: 'resource-link',
      messageType,
      subject: payload.sub,
      resourceLink: {
        id: resourceLink.id,
        ...(resourceLink.title === undefined ? {} : { title: resourceLink.title }),
      },
    };
  }

  if (messageType === LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST) {
    const deepLinkingSettings = parseLtiDeepLinkingSettings(
      payload[LTI_CLAIM_DEEP_LINKING_SETTINGS],
    );
    if (!deepLinkingSettings) {
      throw new LtiLaunchMessageResolutionError(
        'missing_deep_linking_settings',
        'LtiDeepLinkingRequest requires deep_linking_settings',
      );
    }

    return {
      ...base,
      kind: 'deep-linking',
      messageType,
      ...(payload.sub === undefined ? {} : { subject: payload.sub }),
      deepLinkingSettings,
    };
  }

  throw new LtiLaunchMessageResolutionError(
    'unsupported_message_type',
    `Unsupported LTI message_type: ${messageType}`,
  );
}

function getPayload(input: LTI13JwtPayload | LTISession): LTI13JwtPayload {
  if ('jwtPayload' in input) {
    return LTI13JwtPayloadSchema.parse(input.jwtPayload);
  }

  return LTI13JwtPayloadSchema.parse(input);
}

function resolveBaseLaunchMessage(
  payload: LTI13JwtPayload,
): ResolvedLtiLaunchMessageBase {
  const roles = payload[LTI_CLAIM_ROLES] ?? [];
  const context = payload[LTI_CLAIM_CONTEXT];

  return {
    issuer: payload.iss,
    audience: payload.aud,
    deploymentId: payload[LTI_CLAIM_DEPLOYMENT_ID],
    messageType: payload[LTI_CLAIM_MESSAGE_TYPE],
    targetLinkUri: payload[LTI_CLAIM_TARGET_LINK_URI],
    version: payload[LTI_CLAIM_VERSION],
    roles,
    roleKinds: classifyLtiRoles(roles),
    simplifiedRoles: simplifyLtiRoles(roles),
    ...(context === undefined
      ? {}
      : {
          context: {
            id: context.id,
            ...(context.label === undefined ? {} : { label: context.label }),
            ...(context.title === undefined ? {} : { title: context.title }),
          },
        }),
    customParameters: payload[LTI_CLAIM_CUSTOM] ?? {},
  };
}
