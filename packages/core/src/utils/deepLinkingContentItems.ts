import type { DeepLinkingLtiResourceLink } from '../schemas/index.js';
import { LtiResourceLinkSchema } from '../schemas/lti13/deepLinking/contentItem.schema.js';

export interface CreateLtiResourceLinkContentItemInput {
  title?: string;
  text?: string;
  url?: string;
  custom?: Record<string, string>;
  lineItem?: {
    label?: string;
    scoreMaximum: number;
    resourceId?: string;
    tag?: string;
    gradesReleased?: boolean;
  };
}

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
    type: 'ltiResourceLink' as const,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.text === undefined ? {} : { text: input.text }),
    ...(input.url === undefined ? {} : { url: input.url }),
    ...(input.custom === undefined ? {} : { custom: input.custom }),
    ...(input.lineItem === undefined ? {} : { lineItem: input.lineItem }),
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
