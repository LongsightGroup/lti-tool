export type CanvasCloudEnvironment = 'production' | 'beta' | 'test';

export interface CanvasPlatformBinding {
  readonly iss: string;
  readonly authUrl: string;
  readonly tokenUrl: string;
  readonly jwksUrl: string;
}

const productionBinding = {
  iss: 'https://canvas.instructure.com',
  authUrl: 'https://sso.canvaslms.com/api/lti/authorize_redirect',
  tokenUrl: 'https://sso.canvaslms.com/login/oauth2/token',
  jwksUrl: 'https://sso.canvaslms.com/api/lti/security/jwks',
} satisfies CanvasPlatformBinding;

const betaBinding = {
  iss: 'https://canvas.beta.instructure.com',
  authUrl: 'https://sso.beta.canvaslms.com/api/lti/authorize_redirect',
  tokenUrl: 'https://sso.beta.canvaslms.com/login/oauth2/token',
  jwksUrl: 'https://sso.beta.canvaslms.com/api/lti/security/jwks',
} satisfies CanvasPlatformBinding;

const testBinding = {
  iss: 'https://canvas.test.instructure.com',
  authUrl: 'https://sso.test.canvaslms.com/api/lti/authorize_redirect',
  tokenUrl: 'https://sso.test.canvaslms.com/login/oauth2/token',
  jwksUrl: 'https://sso.test.canvaslms.com/api/lti/security/jwks',
} satisfies CanvasPlatformBinding;

export function resolveCanvasPlatformBinding(
  environment: CanvasCloudEnvironment,
): CanvasPlatformBinding {
  switch (environment) {
    case 'production':
      return { ...productionBinding };
    case 'beta':
      return { ...betaBinding };
    case 'test':
      return { ...testBinding };
    default:
      return unsupportedCanvasEnvironment(environment);
  }
}

function unsupportedCanvasEnvironment(environment: never): never {
  throw new Error(`Unsupported Canvas environment: ${String(environment)}`);
}
