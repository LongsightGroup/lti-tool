import {
  LTI_AGS_SCOPE_LINEITEM,
  LTI_AGS_SCOPE_RESULT_READONLY,
  LTI_AGS_SCOPE_SCORE,
  LTI_CLAIM_PLATFORM_CONFIGURATION,
  LTI_CLAIM_TOOL_CONFIGURATION,
  LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST,
  LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST,
  LTI_NRPS_SCOPE_CONTEXT_MEMBERSHIP_READONLY,
} from '../constants.js';
import type { DynamicRegistrationConfig } from '../interfaces/ltiConfig.js';
import {
  CanvasStaticRegistrationConfigSchema,
  type CanvasStaticRegistrationConfig,
  type CanvasStaticRegistrationPlacement,
  type CanvasStaticRegistrationPrivacyLevel,
} from '../schemas/canvasStaticRegistration.schema.js';
import type { DynamicRegistrationAppState } from '../schemas/lti13/dynamicRegistration/dynamicRegistrationAppState.schema.js';
import type { DynamicRegistrationSelectedService } from '../schemas/lti13/dynamicRegistration/ltiDynamicRegistration.schema.js';
import type { LTIMessage } from '../schemas/lti13/dynamicRegistration/ltiMessages.schema.js';
import type { OpenIDConfiguration } from '../schemas/lti13/dynamicRegistration/openIDConfiguration.schema.js';
import { resolveCanvasPlatformBinding } from '../utils/canvasPlatformBinding.js';

import { buildToolRegistrationPayload } from './dynamicRegistrationPayload.js';

const CANVAS_CLOUD_PLATFORM = 'canvas.instructure.com';
const CANVAS_PRIVACY_LEVEL_CLAIM = 'https://canvas.instructure.com/lti/privacy_level';
const CANVAS_TOOL_ID_CLAIM = 'https://canvas.instructure.com/lti/tool_id';
const CANVAS_PRODUCTION_BINDING = resolveCanvasPlatformBinding('production');
const CANVAS_STATIC_OPEN_ID_CONFIGURATION: OpenIDConfiguration = {
  issuer: CANVAS_PRODUCTION_BINDING.iss,
  authorization_endpoint: CANVAS_PRODUCTION_BINDING.authUrl,
  registration_endpoint: 'https://sso.canvaslms.com/api/lti/registrations',
  jwks_uri: CANVAS_PRODUCTION_BINDING.jwksUrl,
  token_endpoint: CANVAS_PRODUCTION_BINDING.tokenUrl,
  token_endpoint_auth_methods_supported: ['private_key_jwt'],
  token_endpoint_auth_signing_alg_values_supported: ['RS256'],
  scopes_supported: [
    LTI_AGS_SCOPE_LINEITEM,
    LTI_AGS_SCOPE_RESULT_READONLY,
    LTI_AGS_SCOPE_SCORE,
    LTI_NRPS_SCOPE_CONTEXT_MEMBERSHIP_READONLY,
  ],
  response_types_supported: ['id_token'],
  id_token_signing_alg_values_supported: ['RS256'],
  claims_supported: ['iss', 'sub', 'name', 'email'],
  subject_types_supported: ['public'],
  [LTI_CLAIM_PLATFORM_CONFIGURATION]: {
    product_family_code: 'canvas',
    version: 'cloud',
    messages_supported: [
      { type: LTI_MESSAGE_TYPE_RESOURCE_LINK_REQUEST },
      { type: LTI_MESSAGE_TYPE_DEEP_LINKING_REQUEST },
    ],
  },
};

export type CanvasStaticRegistrationConfigErrorCode =
  | 'missing_description'
  | 'missing_privacy_level';

export interface BuildCanvasStaticRegistrationConfigInput {
  readonly config: DynamicRegistrationConfig;
  readonly selectedServices: readonly DynamicRegistrationSelectedService[];
  readonly appState?: DynamicRegistrationAppState;
}

export class CanvasStaticRegistrationConfigError extends Error {
  readonly code: CanvasStaticRegistrationConfigErrorCode;

  constructor(code: CanvasStaticRegistrationConfigErrorCode, message: string) {
    super(message);
    this.name = 'CanvasStaticRegistrationConfigError';
    this.code = code;
  }
}

export function buildCanvasStaticRegistrationConfig(
  input: BuildCanvasStaticRegistrationConfigInput,
): CanvasStaticRegistrationConfig {
  const payload = buildToolRegistrationPayload({
    config: input.config,
    openIdConfiguration: CANVAS_STATIC_OPEN_ID_CONFIGURATION,
    selectedServices: input.selectedServices,
    ...(input.appState === undefined ? {} : { appState: input.appState }),
  });
  const toolConfiguration = payload[LTI_CLAIM_TOOL_CONFIGURATION];
  const description = requireToolDescription(toolConfiguration.description);
  const privacyLevel = requireCanvasPrivacyLevel(
    toolConfiguration[CANVAS_PRIVACY_LEVEL_CLAIM],
  );
  const placements = buildCanvasPlacements({
    messages: toolConfiguration.messages,
    defaultTargetLinkUri: toolConfiguration.target_link_uri,
    defaultText: payload.client_name,
    defaultIconUrl: payload.logo_uri,
  });

  return CanvasStaticRegistrationConfigSchema.parse({
    title: payload.client_name,
    description,
    oidc_initiation_url: payload.initiate_login_uri,
    target_link_uri: toolConfiguration.target_link_uri,
    scopes: splitScope(payload.scope),
    extensions: [
      {
        domain: toolConfiguration.domain,
        platform: CANVAS_CLOUD_PLATFORM,
        privacy_level: privacyLevel,
        ...(typeof toolConfiguration[CANVAS_TOOL_ID_CLAIM] === 'string'
          ? { tool_id: toolConfiguration[CANVAS_TOOL_ID_CLAIM] }
          : {}),
        settings: {
          text: payload.client_name,
          ...(payload.logo_uri === undefined ? {} : { icon_url: payload.logo_uri }),
          placements,
        },
      },
    ],
    public_jwk_url: payload.jwks_uri,
    ...(toolConfiguration.custom_parameters === undefined
      ? {}
      : { custom_fields: toolConfiguration.custom_parameters }),
  });
}

function buildCanvasPlacements(input: {
  messages: readonly LTIMessage[];
  defaultTargetLinkUri: string;
  defaultText: string;
  defaultIconUrl: string | undefined;
}): CanvasStaticRegistrationPlacement[] {
  const placements: CanvasStaticRegistrationPlacement[] = [];
  for (const message of input.messages) {
    for (const placement of message.placements ?? []) {
      placements.push({
        placement,
        message_type: message.type,
        target_link_uri: message.target_link_uri ?? input.defaultTargetLinkUri,
        text: message.label ?? input.defaultText,
        ...(message.icon_uri === undefined && input.defaultIconUrl === undefined
          ? {}
          : { icon_url: message.icon_uri ?? input.defaultIconUrl }),
        ...(message.custom_parameters === undefined
          ? {}
          : { custom_fields: message.custom_parameters }),
      });
    }
  }
  return placements;
}

function requireToolDescription(description: string | undefined): string {
  if (description === undefined || description.trim() === '') {
    throw new CanvasStaticRegistrationConfigError(
      'missing_description',
      'Canvas static registration config requires dynamicRegistration.description',
    );
  }
  return description;
}

function requireCanvasPrivacyLevel(value: unknown): CanvasStaticRegistrationPrivacyLevel {
  if (
    value === 'public' ||
    value === 'name_only' ||
    value === 'email_only' ||
    value === 'anonymous'
  ) {
    return value;
  }

  throw new CanvasStaticRegistrationConfigError(
    'missing_privacy_level',
    'Canvas static registration config requires platforms.canvas.privacyLevel',
  );
}

function splitScope(scope: string | undefined): string[] {
  return scope === undefined || scope.trim() === ''
    ? []
    : scope.split(/\s+/).filter((value) => value.length > 0);
}
