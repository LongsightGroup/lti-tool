import * as z from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.string().min(1).optional(),
);

/**
 * Schema for OIDC third-party initiated login parameters received from a platform.
 *
 * The LTI 1.3 spec requires iss, login_hint, and target_link_uri. Some platforms omit
 * client_id or lti_deployment_id when the issuer only has one matching registration.
 */
export const LTI13LoginInitiationSchema = z.object({
  iss: z.string().min(1),
  login_hint: z.string().min(1),
  target_link_uri: z.url(),
  client_id: optionalNonEmptyString,
  lti_deployment_id: optionalNonEmptyString,
  lti_message_hint: optionalNonEmptyString,
  lti_storage_target: optionalNonEmptyString,
});

export type LTI13LoginInitiation = z.infer<typeof LTI13LoginInitiationSchema>;

export function parseLtiLoginInitiation(input: unknown): LTI13LoginInitiation {
  return LTI13LoginInitiationSchema.parse(input);
}

export const LTI13LoginSchema = z.object({
  iss: z.string().min(1),
  login_hint: z.string().min(1),
  target_link_uri: z.url(),
  client_id: z.string().min(1),
  lti_deployment_id: z.string().min(1),
  lti_message_hint: z.string().optional(),
});

/**
 * Schema for handleLogin method parameters - extends LTI13LoginSchema
 * with the additional launchUrl parameter needed for method calls
 */
export const HandleLoginParamsSchema = LTI13LoginSchema.extend({
  launchUrl: z.union([z.url(), z.instanceof(URL)]),
});
