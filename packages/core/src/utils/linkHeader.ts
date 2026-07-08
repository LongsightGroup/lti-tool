export type ParsedLinkHeader = {
  readonly next?: string;
  readonly differences?: string;
};

/**
 * Splits an RFC 8288 Link header value into individual link-value parts.
 */
export function splitLinkHeader(headerValue: string): string[] {
  return headerValue
    .split(/,(?=\s*<)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Parses LTI platform Link headers for pagination and roster diff endpoints.
 */
export function parseLinkHeader(
  headerValue: string | null | undefined,
): ParsedLinkHeader {
  if (
    headerValue === null ||
    headerValue === undefined ||
    headerValue.trim().length === 0
  ) {
    return {};
  }

  const parsed: { next?: string; differences?: string } = {};

  for (const part of splitLinkHeader(headerValue)) {
    const urlMatch = part.match(/<([^>]+)>/);
    const relMatch = part.match(/\brel="?([^";,\s]+)"?/i);
    if (!urlMatch || !relMatch) continue;

    const url = urlMatch[1];
    const rel = relMatch[1].toLowerCase();
    if (rel === 'next') parsed.next = url;
    if (rel === 'differences') parsed.differences = url;
  }

  return parsed;
}
