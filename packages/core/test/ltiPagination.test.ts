import { describe, expect, it } from 'vitest';

import { followLtiPages } from '../src/utils/ltiPagination.js';

describe('followLtiPages', () => {
  it('aggregates items across pages until nextUrl is absent', async () => {
    const result = await followLtiPages({
      maxPages: 10,
      fetchPage: (pageUrl) => {
        if (pageUrl === undefined) {
          return Promise.resolve({
            success: true,
            data: {
              items: ['page-1'],
              nextUrl: 'https://platform.example.com/page-2',
            },
          });
        }

        return Promise.resolve({
          success: true,
          data: {
            items: ['page-2'],
          },
        });
      },
    });

    expect(result).toEqual({
      success: true,
      data: {
        items: ['page-1', 'page-2'],
        pagesFetched: 2,
        truncated: false,
      },
    });
  });

  it('reports truncation when maxPages is reached', async () => {
    const result = await followLtiPages({
      maxPages: 1,
      fetchPage: () =>
        Promise.resolve({
          success: true,
          data: {
            items: ['page-1'],
            nextUrl: 'https://platform.example.com/page-2',
          },
        }),
    });

    expect(result).toEqual({
      success: true,
      data: {
        items: ['page-1'],
        pagesFetched: 1,
        truncated: true,
        nextUrl: 'https://platform.example.com/page-2',
      },
    });
  });

  it('stops early when onPage returns stop', async () => {
    const result = await followLtiPages({
      maxPages: 10,
      fetchPage: () =>
        Promise.resolve({
          success: true,
          data: {
            items: ['only-page'],
            nextUrl: 'https://platform.example.com/page-2',
          },
        }),
      onPage: () => 'stop',
    });

    expect(result).toEqual({
      success: true,
      data: {
        items: ['only-page'],
        pagesFetched: 1,
        truncated: false,
      },
    });
  });
});
