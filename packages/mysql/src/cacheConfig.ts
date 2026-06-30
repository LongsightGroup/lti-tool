import type { LTISession } from '@longsightgroup/lti-tool';
import { LRUCache } from 'lru-cache';

export const SESSION_CACHE = new LRUCache<string, LTISession | undefinedSession>({
  max: 1000,
  ttl: 1000 * 60 * 5, // 5 minutes (shorter than clients)
});

export const SESSION_TTL = 60 * 60 * 24; // session ttl is one day
export const NONCE_TTL = 60 * 15; // nonce ttl is fifteen minutes

// we need an undefined value to handle cache misses and cache them
export const undefinedSessionValue = Symbol('undefinedSession');
export type undefinedSession = typeof undefinedSessionValue;
