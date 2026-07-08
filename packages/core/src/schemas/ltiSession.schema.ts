import * as z from 'zod';

import { DynamicRegistrationAppStateSchema } from './lti13/dynamicRegistration/dynamicRegistrationAppState.schema.js';
import { openIDConfigurationSchema } from './lti13/dynamicRegistration/openIDConfiguration.schema.js';
import { LTI13JwtPayloadSchema } from './lti13/lti13JwtPayload.schema.js';

export const LTISessionUserSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  familyName: z.string().optional(),
  givenName: z.string().optional(),
  roles: z.array(z.string()),
});

export const LTISessionContextSchema = z.object({
  id: z.string(),
  label: z.string(),
  title: z.string(),
});

export const LTISessionPlatformSchema = z.object({
  issuer: z.string(),
  clientId: z.string(),
  deploymentId: z.string(),
  name: z.string(),
});

export const LTISessionLaunchSchema = z.object({
  target: z.string(),
});

export const LTISessionResourceLinkSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
});

export const LTISessionServicesSchema = z.object({
  ags: z
    .object({
      lineitem: z.string().optional(),
      lineitems: z.string().optional(),
      scopes: z.array(z.string()),
    })
    .optional(),
  nrps: z
    .object({
      membershipUrl: z.string(),
      versions: z.array(z.string()),
    })
    .optional(),
  deepLinking: z
    .object({
      returnUrl: z.string(),
      acceptTypes: z.array(z.string()),
      acceptPresentationDocumentTargets: z.array(z.string()),
      acceptMediaTypes: z.string().optional(),
      acceptMultiple: z.boolean(),
      acceptLineItem: z.boolean().optional(),
      autoCreate: z.boolean(),
      title: z.string().optional(),
      text: z.string().optional(),
      data: z.string().optional(),
    })
    .optional(),
});

export const LTISessionSchema = z.object({
  jwtPayload: LTI13JwtPayloadSchema,
  id: z.string(),
  user: LTISessionUserSchema,
  context: LTISessionContextSchema,
  platform: LTISessionPlatformSchema,
  launch: LTISessionLaunchSchema,
  resourceLink: LTISessionResourceLinkSchema.optional(),
  services: LTISessionServicesSchema.optional(),
  customParameters: z.record(z.string(), z.string()),
  isAdmin: z.boolean(),
  isInstructor: z.boolean(),
  isStudent: z.boolean(),
  isAssignmentAndGradesAvailable: z.boolean(),
  isDeepLinkingAvailable: z.boolean(),
  isNameAndRolesAvailable: z.boolean(),
});

export const LTIDynamicRegistrationSessionSchema = z.object({
  openIdConfiguration: openIDConfigurationSchema,
  registrationToken: z.string().optional(),
  appState: DynamicRegistrationAppStateSchema.optional(),
  expiresAt: z.number(),
});
