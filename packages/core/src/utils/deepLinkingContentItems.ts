import type * as z from 'zod';

import type { DeepLinkingLtiResourceLink } from '../schemas/index.js';
import { LtiResourceLinkSchema } from '../schemas/lti13/deepLinking/contentItem.schema.js';

/** Input for building an LTI Resource Link content item; `type` is fixed by the builder. */
export type CreateLtiResourceLinkContentItemInput = Omit<
  z.input<typeof LtiResourceLinkSchema>,
  'type'
>;

export class LtiContentItemConstructionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LtiContentItemConstructionError';
  }
}

/**
 * Builds and validates an LTI Deep Linking ltiResourceLink content item.
 */
export const createLtiResourceLinkContentItem = (
  input: CreateLtiResourceLinkContentItemInput,
): DeepLinkingLtiResourceLink => {
  const item = {
    ...input,
    type: 'ltiResourceLink' as const,
  };
  const parsed = LtiResourceLinkSchema.safeParse(item);

  if (!parsed.success) {
    throw new LtiContentItemConstructionError(
      'Invalid LTI resource link content item',
      parsed.error,
    );
  }

  return parsed.data;
};
