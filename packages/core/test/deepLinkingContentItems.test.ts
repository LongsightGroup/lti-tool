import { describe, expect, it } from 'vitest';

import {
  ContentItemSchema,
  LtiContentItemConstructionError,
  createLtiResourceLinkContentItem,
} from '../src/index.js';

describe('Deep Linking content item builders', () => {
  it('builds a minimal ltiResourceLink content item', () => {
    expect(createLtiResourceLinkContentItem({ title: 'Launch activity' })).toEqual({
      type: 'ltiResourceLink',
      title: 'Launch activity',
    });
  });

  it('builds an ltiResourceLink with custom parameters and AGS line item metadata', () => {
    expect(
      createLtiResourceLinkContentItem({
        title: 'Project',
        text: 'Open the project',
        url: 'https://tool.example.com/lti/project',
        custom: {
          placementId: 'placement-123',
        },
        lineItem: {
          label: 'Project score',
          scoreMaximum: 100,
          resourceId: 'project',
          tag: 'summative',
          gradesReleased: true,
        },
      }),
    ).toEqual({
      type: 'ltiResourceLink',
      title: 'Project',
      text: 'Open the project',
      url: 'https://tool.example.com/lti/project',
      custom: {
        placementId: 'placement-123',
      },
      lineItem: {
        label: 'Project score',
        scoreMaximum: 100,
        resourceId: 'project',
        tag: 'summative',
        gradesReleased: true,
      },
    });
  });

  it('builds an ltiResourceLink line item without an explicit label', () => {
    expect(
      createLtiResourceLinkContentItem({
        title: 'Project',
        lineItem: {
          scoreMaximum: 100,
        },
      }),
    ).toEqual({
      type: 'ltiResourceLink',
      title: 'Project',
      lineItem: {
        scoreMaximum: 100,
      },
    });
  });

  it('preserves ltiResourceLink presentation options', () => {
    expect(
      createLtiResourceLinkContentItem({
        title: 'Project',
        window: {
          targetName: 'project-window',
          width: 800,
          height: 600,
          windowFeatures: 'noopener',
        },
        iframe: {
          width: 640,
          height: 480,
        },
      }),
    ).toEqual({
      type: 'ltiResourceLink',
      title: 'Project',
      window: {
        targetName: 'project-window',
        width: 800,
        height: 600,
        windowFeatures: 'noopener',
      },
      iframe: {
        width: 640,
        height: 480,
      },
    });
  });

  it('preserves link window dimensions', () => {
    const parsed = ContentItemSchema.parse({
      type: 'link',
      url: 'https://tool.example.com/content',
      window: {
        targetName: 'content-window',
        width: 800,
        height: 600,
        windowFeatures: 'noopener',
      },
      iframe: {
        src: 'https://tool.example.com/embed',
        width: 640,
        height: 480,
      },
    });

    expect(parsed).toEqual({
      type: 'link',
      url: 'https://tool.example.com/content',
      window: {
        targetName: 'content-window',
        width: 800,
        height: 600,
        windowFeatures: 'noopener',
      },
      iframe: {
        src: 'https://tool.example.com/embed',
        width: 640,
        height: 480,
      },
    });
  });

  it('rejects non-positive ltiResourceLink score maximum values', () => {
    expect(() =>
      createLtiResourceLinkContentItem({
        title: 'Project',
        lineItem: {
          scoreMaximum: 0,
        },
      }),
    ).toThrowError(LtiContentItemConstructionError);
  });

  it('rejects invalid resource link content items with a typed error', () => {
    expect(() =>
      createLtiResourceLinkContentItem({
        url: 'not-a-url',
      }),
    ).toThrowError(LtiContentItemConstructionError);
  });
});
