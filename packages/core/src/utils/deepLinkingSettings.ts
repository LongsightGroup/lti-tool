import { DeepLinkingSettingsSchema } from '../schemas/lti13/claims/serviceClaims.schema.js';

export interface LtiDeepLinkingSettings {
  returnUrl: string;
  acceptTypes: string[];
  acceptPresentationDocumentTargets: string[];
  acceptMediaTypes?: string;
  acceptMultiple: boolean;
  autoCreate: boolean;
  data?: string;
}

export function parseLtiDeepLinkingSettings(
  input: unknown,
): LtiDeepLinkingSettings | undefined {
  const settings = DeepLinkingSettingsSchema.parse(input);
  if (!settings) return undefined;

  return {
    returnUrl: settings.deep_link_return_url,
    acceptTypes: settings.accept_types,
    acceptPresentationDocumentTargets: settings.accept_presentation_document_targets,
    ...(settings.accept_media_types === undefined
      ? {}
      : { acceptMediaTypes: settings.accept_media_types }),
    acceptMultiple: settings.accept_multiple ?? false,
    autoCreate: settings.auto_create ?? false,
    ...(settings.data === undefined ? {} : { data: settings.data }),
  };
}

export function isLtiDeepLinkingContentTypeAccepted(
  settings: LtiDeepLinkingSettings,
  contentType: string,
): boolean {
  return settings.acceptTypes.includes(contentType) || settings.acceptTypes.includes('*');
}
