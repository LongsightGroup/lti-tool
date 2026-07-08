import { describe, expect, it } from 'vitest';

import { parseLinkHeader, splitLinkHeader } from '../src/utils/linkHeader.js';

describe('link header parsing', () => {
  it('splits comma-separated link values', () => {
    expect(
      splitLinkHeader(
        '<https://platform.example.com/page-2>; rel="next", <https://platform.example.com/diff>; rel="differences"',
      ),
    ).toEqual([
      '<https://platform.example.com/page-2>; rel="next"',
      '<https://platform.example.com/diff>; rel="differences"',
    ]);
  });

  it('parses next and differences links', () => {
    expect(
      parseLinkHeader(
        '<https://platform.example.com/nrps/page-2>; rel="next", <https://platform.example.com/nrps/diff>; rel="differences"',
      ),
    ).toEqual({
      next: 'https://platform.example.com/nrps/page-2',
      differences: 'https://platform.example.com/nrps/diff',
    });
  });

  it('returns an empty object when the header is missing', () => {
    expect(parseLinkHeader(null)).toEqual({});
    expect(parseLinkHeader(undefined)).toEqual({});
    expect(parseLinkHeader('')).toEqual({});
  });
});
