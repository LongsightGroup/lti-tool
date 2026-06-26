import { describe, expect, it } from 'vitest';

import {
  isLtiDeepLinkingContentTypeAccepted,
  parseLtiDeepLinkingSettings,
} from '../src/index.js';

describe('Deep Linking settings helpers', () => {
  it('parses and normalizes Deep Linking settings claims', () => {
    const parsed = parseLtiDeepLinkingSettings({
      deep_link_return_url: 'https://platform.example.com/deep_links',
      accept_types: ['link', 'file'],
      accept_presentation_document_targets: ['iframe', 'window'],
      accept_media_types: 'image/*,text/html',
      accept_multiple: true,
      auto_create: true,
      data: 'custom_data_123',
    });

    expect(parsed).toEqual({
      returnUrl: 'https://platform.example.com/deep_links',
      acceptTypes: ['link', 'file'],
      acceptPresentationDocumentTargets: ['iframe', 'window'],
      acceptMediaTypes: 'image/*,text/html',
      acceptMultiple: true,
      autoCreate: true,
      data: 'custom_data_123',
    });
  });

  it('defaults optional booleans to false', () => {
    const parsed = parseLtiDeepLinkingSettings({
      deep_link_return_url: 'https://platform.example.com/deep_links',
      accept_types: ['link'],
      accept_presentation_document_targets: ['iframe'],
    });

    expect(parsed).toEqual({
      returnUrl: 'https://platform.example.com/deep_links',
      acceptTypes: ['link'],
      acceptPresentationDocumentTargets: ['iframe'],
      acceptMultiple: false,
      autoCreate: false,
    });
  });

  it('returns undefined when the claim is absent', () => {
    expect(parseLtiDeepLinkingSettings(undefined)).toBeUndefined();
  });

  it('validates accepted content types', () => {
    const parsed = parseLtiDeepLinkingSettings({
      deep_link_return_url: 'https://platform.example.com/deep_links',
      accept_types: ['link'],
      accept_presentation_document_targets: ['iframe'],
    });

    if (!parsed) throw new Error('Expected Deep Linking settings to parse');

    expect(isLtiDeepLinkingContentTypeAccepted(parsed, 'link')).toBe(true);
    expect(isLtiDeepLinkingContentTypeAccepted(parsed, 'file')).toBe(false);
  });
});
