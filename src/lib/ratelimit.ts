/**
 * Tiny in-memory, per-key fixed-window rate limiter — brute-force protection
 * for the auth endpoints (admin login, access-code gate). Single-process only
 * (like the session store); swap for Redis if you run multiple instances.
 */

type Bucket = { count: number; resetAt: number };

const g = globalThis as unknown as { __atbashRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__atbashRate ??= new Map());

export type RateResult = { ok: boolean; retryAfterSec: number };

/**
 * @param key       unique per client+action, e.g. `login:${ip}`
 * @param limit     max attempts allowed within the window
 * @param windowMs  window length in ms
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Best-effort client IP from proxy headers (falls back to a shared bucket). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}
