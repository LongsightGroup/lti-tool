import type { LTILaunchConfig } from '@longsightgroup/lti-tool';

const LAUNCH_CONFIG_CACHE_MAX_ENTRIES = 1000;
const LAUNCH_CONFIG_CACHE_TTL_MILLISECONDS = 1000 * 60 * 15;

type LaunchConfigCacheEntry = {
  readonly expiresAt: number;
  readonly value: LTILaunchConfig | undefinedLaunchConfig;
};

class LaunchConfigCache {
  private readonly entries = new Map<string, LaunchConfigCacheEntry>();

  get(key: string): LTILaunchConfig | undefinedLaunchConfig | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: LTILaunchConfig | undefinedLaunchConfig): void {
    const now = Date.now();

    this.entries.delete(key);
    this.entries.set(key, {
      expiresAt: now + LAUNCH_CONFIG_CACHE_TTL_MILLISECONDS,
      value,
    });

    this.deleteExpired(now);
    this.trimToMaxEntries();
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private deleteExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private trimToMaxEntries(): void {
    while (this.entries.size > LAUNCH_CONFIG_CACHE_MAX_ENTRIES) {
      const oldestEntry = this.entries.keys().next();
      if (oldestEntry.done) return;

      this.entries.delete(oldestEntry.value);
    }
  }
}

export const LAUNCH_CONFIG_CACHE = new LaunchConfigCache();

export const SESSION_TTL = 60 * 60 * 24; // session ttl is one day

// we need an undefined value to handle cache misses and cache them
export const undefinedLaunchConfigValue = Symbol('undefinedLaunchConfig');
export type undefinedLaunchConfig = typeof undefinedLaunchConfigValue;
