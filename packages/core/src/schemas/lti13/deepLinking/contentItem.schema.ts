import * as z from 'zod';

const ContentItemExtensionValueSchema = z.json();

/**
 * Zod schema for base content item properties shared across all content item types.
 * Contains common metadata fields like title, text, icon, and thumbnail.
 *
 * @property title - Optional human-readable title for the content item
 * @property text - Optional descriptive text for the content item
 * @property icon - Optional icon image with URL and dimensions
 * @property thumbnail - Optional thumbnail image with URL and dimensions
 *
 * @see https://www.imsglobal.org/spec/lti-dl/v2p0#content-item-types
 */
const BaseContentItemSchema = z
  .object({
    title: z.string().optional(),
    text: z.string().optional(),
    icon: z
      .object({
        url: z.url(),
        width: z.number().optional(),
        height: z.number().optional(),
      })
      .optional(),
    thumbnail: z
      .object({
        url: z.url(),
        width: z.number().optional(),
        height: z.number().optional(),
      })
      .optional(),
  })
  .catchall(ContentItemExtensionValueSchema);

const WindowTargetSchema = z.object({
  targetName: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  windowFeatures: z.string().optional(),
});

const LinkIframeSchema = z.object({
  src: z.url(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const LtiResourceLinkIframeSchema = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
});

const PresentationDocumentTargetSchema = z.enum(['embed', 'iframe', 'window']);

const ContentItemPresentationSchema = z.object({
  documentTarget: PresentationDocumentTargetSchema,
});

/**
 * Zod schema for LTI Resource Link content item.
 * Represents a launchable LTI tool resource that can be embedded in the platform.
 *
 * @property type - Always 'ltiResourceLink' for this content type
 * @property url - Optional launch URL for the resource
 * @property custom - Optional custom parameters passed to the tool on launch
 * @property presentation - Optional preferred document target for platforms that consume it
 * @property lineItem - Optional gradebook column configuration for this resource
 * @property available - Optional availability window with start/end dates
 * @property submission - Optional submission window with start/end dates
 *
 * @see https://www.imsglobal.org/spec/lti-dl/v2p0#lti-resource-link
 */
export const LtiResourceLinkSchema = BaseContentItemSchema.extend({
  type: z.literal('ltiResourceLink'),
  url: z.url().optional(),
  window: WindowTargetSchema.optional(),
  iframe: LtiResourceLinkIframeSchema.optional(),
  presentation: ContentItemPresentationSchema.optional(),
  custom: z.record(z.string(), z.string()).optional(),
  lineItem: z
    .object({
      scoreMaximum: z.number().positive(),
      label: z.string().optional(),
      resourceId: z.string().optional(),
      tag: z.string().optional(),
      gradesReleased: z.boolean().optional(),
    })
    .optional(),
  available: z
    .object({
      startDateTime: z.iso.datetime().optional(),
      endDateTime: z.iso.datetime().optional(),
    })
    .optional(),
  submission: z
    .object({
      startDateTime: z.iso.datetime().optional(),
      endDateTime: z.iso.datetime().optional(),
    })
    .optional(),
});

/**
 * Zod schema for simple link content item.
 * Represents a standard web link that can be opened in various ways.
 *
 * @property type - Always 'link' for this content type
 * @property url - Target URL for the link
 * @property embed - Optional HTML embed code
 * @property window - Optional window configuration for opening the link
 * @property iframe - Optional iframe configuration for embedding the link
 *
 * @see https://www.imsglobal.org/spec/lti-dl/v2p0#link
 */
export const LinkSchema = BaseContentItemSchema.extend({
  type: z.literal('link'),
  url: z.url(),
  embed: z
    .object({
      html: z.string(),
    })
    .optional(),
  window: WindowTargetSchema.optional(),
  iframe: LinkIframeSchema.optional(),
});

/**
 * Zod schema for HTML fragment content item.
 * Represents raw HTML content to be embedded directly in the platform.
 *
 * @property type - Always 'html' for this content type
 * @property html - HTML content to be embedded
 *
 * @see https://www.imsglobal.org/spec/lti-dl/v2p0#html-fragment
 */
export const HtmlSchema = BaseContentItemSchema.extend({
  type: z.literal('html'),
  html: z.string(),
});

/**
 * Zod schema for file content item.
 * Represents a downloadable file resource.
 *
 * @property type - Always 'file' for this content type
 * @property url - URL to download the file
 * @property mediaType - MIME type of the file
 * @property expiresAt - Optional expiration timestamp for the file URL
 *
 * @see https://www.imsglobal.org/spec/lti-dl/v2p0#file
 */
export const FileSchema = BaseContentItemSchema.extend({
  type: z.literal('file'),
  url: z.url(),
  mediaType: z.string(),
  expiresAt: z.iso.datetime().optional(),
});

/**
 * Zod schema for image content item.
 * Represents an image resource with optional dimensions.
 *
 * @property type - Always 'image' for this content type
 * @property url - URL to the image
 * @property width - Optional image width in pixels
 * @property height - Optional image height in pixels
 *
 * @see https://www.imsglobal.org/spec/lti-dl/v2p0#image
 */
export const ImageSchema = BaseContentItemSchema.extend({
  type: z.literal('image'),
  url: z.url(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const KnownContentItemSchemas = [
  LtiResourceLinkSchema,
  LinkSchema,
  HtmlSchema,
  FileSchema,
  ImageSchema,
] as const;
const knownContentItemTypes: ReadonlySet<string> = new Set(
  KnownContentItemSchemas.map((schema) => schema.shape.type.value),
);

/**
 * Zod schema for validating built-in Deep Linking content item types.
 * Uses discriminated union on the 'type' field to determine the specific content item schema.
 * Supports: ltiResourceLink, link, html, file, and image content types.
 *
 * @see https://www.imsglobal.org/spec/lti-dl/v2p0#content-item-types
 */
const KnownContentItemSchema = z.discriminatedUnion('type', KnownContentItemSchemas);

/**
 * Zod schema for validating custom Deep Linking extension content item types.
 * Built-in item types are excluded so invalid built-in items cannot fall through as custom items.
 *
 * @see https://www.imsglobal.org/spec/lti-dl/v2p0#content-item-types
 */
export const CustomContentItemSchema = z
  .object({
    type: z
      .string()
      .refine(
        (type) => !knownContentItemTypes.has(type),
        'Custom content item type must not match a built-in content item type',
      ),
  })
  .catchall(ContentItemExtensionValueSchema);

/**
 * Zod schema for validating any Deep Linking content item type.
 * Supports built-in content items and custom extension content items.
 *
 * @see https://www.imsglobal.org/spec/lti-dl/v2p0#content-item-types
 */
export const ContentItemSchema = z.union([
  KnownContentItemSchema,
  CustomContentItemSchema,
]);

/**
 * Type representing a validated LTI Resource Link content item.
 * Used for creating launchable LTI tool resources.
 */
export type DeepLinkingLtiResourceLink = z.infer<typeof LtiResourceLinkSchema>;

/**
 * Type representing a validated simple link content item.
 * Used for creating standard web links.
 */
export type DeepLinkingLink = z.infer<typeof LinkSchema>;

/**
 * Type representing a validated HTML fragment content item.
 * Used for embedding raw HTML content.
 */
export type DeepLinkingHtml = z.infer<typeof HtmlSchema>;

/**
 * Type representing a validated file content item.
 * Used for linking to downloadable files.
 */
export type DeepLinkingFile = z.infer<typeof FileSchema>;

/**
 * Type representing a validated image content item.
 * Used for embedding images.
 */
export type DeepLinkingImage = z.infer<typeof ImageSchema>;

/**
 * Type representing a validated custom Deep Linking content item.
 * Used for content item types defined by other specifications or platform extensions.
 */
export type DeepLinkingCustomContentItem = z.infer<typeof CustomContentItemSchema>;

/**
 * Type representing any validated Deep Linking content item.
 * Can be a built-in Deep Linking content item or a custom extension item.
 */
export type DeepLinkingContentItem = z.infer<typeof ContentItemSchema>;
