import { describe, expect, it } from 'vitest';

import { resolveCanvasPlatformBinding } from '../src/index.js';

describe('resolveCanvasPlatformBinding', () => {
  it('resolves production Canvas issuer and endpoint conventions', () => {
    expect(resolveCanvasPlatformBinding('production')).toEqual({
      iss: 'https://canvas.instructure.com',
      authUrl: 'https://sso.canvaslms.com/api/lti/authorize_redirect',
      tokenUrl: 'https://sso.canvaslms.com/login/oauth2/token',
      jwksUrl: 'https://sso.canvaslms.com/api/lti/security/jwks',
    });
  });

  it('resolves beta Canvas issuer and endpoint conventions', () => {
    expect(resolveCanvasPlatformBinding('beta')).toEqual({
      iss: 'https://canvas.beta.instructure.com',
      authUrl: 'https://sso.beta.canvaslms.com/api/lti/authorize_redirect',
      tokenUrl: 'https://sso.beta.canvaslms.com/login/oauth2/token',
      jwksUrl: 'https://sso.beta.canvaslms.com/api/lti/security/jwks',
    });
  });

  it('resolves test Canvas issuer and endpoint conventions', () => {
    expect(resolveCanvasPlatformBinding('test')).toEqual({
      iss: 'https://canvas.test.instructure.com',
      authUrl: 'https://sso.test.canvaslms.com/api/lti/authorize_redirect',
      tokenUrl: 'https://sso.test.canvaslms.com/login/oauth2/token',
      jwksUrl: 'https://sso.test.canvaslms.com/api/lti/security/jwks',
    });
  });

  it('returns a fresh binding object', () => {
    const first = resolveCanvasPlatformBinding('production');
    const second = resolveCanvasPlatformBinding('production');

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
