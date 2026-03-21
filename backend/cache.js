/**
 * Simple in-memory TTL cache — no external dependencies (no Redis needed).
 *
 * Usage:
 *   import { TTLCache } from './cache.js';
 *   const cache = new TTLCache(60_000); // 60-second TTL
 *   cache.set('key', value);
 *   cache.get('key'); // returns value or null if expired
 */

export class TTLCache {
  /**
   * @param {number} ttlMs - Default time-to-live in milliseconds
   * @param {number} maxSize - Maximum number of entries (oldest evicted first)
   */
  constructor(ttlMs = 300_000, maxSize = 500) {
    this.ttl = ttlMs;
    this.maxSize = maxSize;
    /** @type {Map<string, {value: any, exp: number}>} */
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.exp) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    // Evict oldest entry if at capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    this.store.set(key, { value, exp: Date.now() + (ttlMs ?? this.ttl) });
  }

  invalidate(key) {
    this.store.delete(key);
  }

  /** Clear all entries (useful after writes that invalidate cached data). */
  clear() {
    this.store.clear();
  }
}

// ── Pre-built cache instances ────────────────────────────────────────────────

/** Admin stats — short TTL (30s) since the dashboard polls every 30s anyway. */
export const statsCache = new TTLCache(30_000, 10);

/** Doctor listing — 5-minute TTL, keyed by query params. */
export const doctorListCache = new TTLCache(5 * 60_000, 50);
