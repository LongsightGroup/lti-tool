import { describe, expect, it } from 'vitest';

import {
  LtiRequestParseError,
  parseLtiDeepLinkingResponseRequest,
  parseLtiLaunchFormData,
  parseLtiLoginRequest,
} from '../src/index.js';

const idToken =
  'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL3BsYXRmb3JtLmV4YW1wbGUifQ.signature';

describe('LTI request parsing helpers', () => {
  it('parses OIDC login query parameters', () => {
    const url = new URL('https://tool.example.com/lti/login');
    url.searchParams.set('iss', 'https://platform.example.com');
    url.searchParams.set('login_hint', 'login-hint-123');
    url.searchParams.set('target_link_uri', 'https://tool.example.com/content');
    url.searchParams.set('client_id', 'client-123');
    url.searchParams.set('lti_deployment_id', 'deployment-123');

    expect(parseLtiLoginRequest(url)).toEqual({
      iss: 'https://platform.example.com',
      login_hint: 'login-hint-123',
      target_link_uri: 'https://tool.example.com/content',
      client_id: 'client-123',
      lti_deployment_id: 'deployment-123',
    });
  });

  it('reports missing OIDC login parameters with a stable code', () => {
    expect(() => parseLtiLoginRequest(new URLSearchParams())).toThrowError(
      expect.objectContaining({
        name: 'LtiRequestParseError',
        code: 'missing_required_parameter',
      }),
    );
  });

  it('reports invalid OIDC login URL strings with a stable code', () => {
    expect(() => parseLtiLoginRequest('not a url')).toThrowError(
      expect.objectContaining({
        name: 'LtiRequestParseError',
        code: 'invalid_parameter',
      }),
    );
  });

  it('parses launch form data and normalizes id_token', async () => {
    const formData = new FormData();
    formData.set('id_token', idToken);
    formData.set('state', 'state-jwt');

    await expect(parseLtiLaunchFormData(formData)).resolves.toEqual({
      idToken,
      state: 'state-jwt',
    });
  });

  it('reports invalid launch form data with a stable code', async () => {
    const formData = new FormData();
    formData.set('id_token', 'not-a-jwt');
    formData.set('state', 'state-jwt');

    await expect(parseLtiLaunchFormData(formData)).rejects.toThrowError(
      expect.objectContaining({
        name: 'LtiRequestParseError',
        code: 'invalid_parameter',
      }),
    );
  });

  it('parses deep-linking content_items JSON', () => {
    const response = parseLtiDeepLinkingResponseRequest({
      content_items: JSON.stringify([
        {
          type: 'ltiResourceLink',
          title: 'Launch item',
          url: 'https://tool.example.com/launch/item',
          custom: {
            placementId: 'placement-123',
          },
        },
      ]),
    });

    expect(response.contentItems).toEqual([
      {
        type: 'ltiResourceLink',
        title: 'Launch item',
        url: 'https://tool.example.com/launch/item',
        custom: {
          placementId: 'placement-123',
        },
      },
    ]);
  });

  it('reports invalid deep-linking content items with a stable code', () => {
    expect(() =>
      parseLtiDeepLinkingResponseRequest({ content_items: [{}] }),
    ).toThrowError(
      expect.objectContaining({
        name: 'LtiRequestParseError',
        code: 'invalid_content_items',
      }),
    );
  });

  it('exposes a typed parse error class', () => {
    const error = new LtiRequestParseError('invalid_json_body', 'Invalid JSON body');

    expect(error.code).toBe('invalid_json_body');
    expect(error.name).toBe('LtiRequestParseError');
  });
});
