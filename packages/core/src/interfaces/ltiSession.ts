import type { LTI13JwtPayload } from '../schemas/lti13/lti13JwtPayload.schema.js';
import type { LtiDeepLinkingSettings } from '../schemas/ltiDeepLinkingSettings.schema.js';

/**
 * Represents an active LTI session containing user information, context data,
 * and available services after successful launch verification.
 */
export interface LTISession {
  /** Parsed LTI 1.3 JWT payload from the platform for reference */
  jwtPayload: LTI13JwtPayload;

  /** Unique session identifier (UUID) */
  id: string;

  /** User information extracted from LTI claims */
  user: {
    /** Unique user identifier from the platform, absent for anonymous Deep Linking launches */
    id?: string;
    /** User's display name */
    name?: string;
    /** User's email address */
    email?: string;
    /** User's family/last name */
    familyName?: string;
    /** User's given/first name */
    givenName?: string;
    /** Array of LTI role URIs (e.g., 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor') */
    roles: string[];
  };

  /** Course/context information */
  context: {
    /** Unique context identifier from the platform */
    id: string;
    /** Short context label (e.g., course code) */
    label: string;
    /** Full context title (e.g., course name) */
    title: string;
  };

  /** Platform identification */
  platform: {
    /** Platform issuer URL */
    issuer: string;
    /** OAuth2 client identifier */
    clientId: string;
    /** Deployment identifier */
    deploymentId: string;
    /** Human-readable platform name */
    name: string;
  };

  /** Launch target information */
  launch: {
    /** Target link URI where user should be directed */
    target: string;
  };

  /** Resource link information (if applicable) */
  resourceLink?: {
    /** Unique resource link identifier */
    id: string;
    /** Resource link title */
    title?: string;
  };

  /** Available LTI Advantage services */
  services?: {
    /** Assignment and Grade Services (AGS) configuration */
    ags?: {
      /** Single line item endpoint URL */
      lineitem?: string;
      /** Line items collection endpoint URL */
      lineitems?: string;
      /** Available AGS scopes */
      scopes: string[];
    };
    /** Names and Role Provisioning Services (NRPS) configuration */
    nrps?: {
      /** Membership endpoint URL */
      membershipUrl: string;
      /** Supported NRPS versions */
      versions: string[];
    };
    /** Deep Linking configuration */
    deepLinking?: LtiDeepLinkingSettings;
  };

  /** Custom parameters passed from platform */
  customParameters: Record<string, string>;

  /** Convenience flags for role checking */
  /** True if user has administrator privileges */
  isAdmin: boolean;
  /** True if user has instructor/teacher role */
  isInstructor: boolean;
  /** True if user has student/learner role */
  isStudent: boolean;
  /** True if Assignment and Grade Services are available */
  isAssignmentAndGradesAvailable: boolean;
  /** True if Deep Linking is available */
  isDeepLinkingAvailable: boolean;
  /** True if Names and Role Provisioning Services are available */
  isNameAndRolesAvailable: boolean;
}
