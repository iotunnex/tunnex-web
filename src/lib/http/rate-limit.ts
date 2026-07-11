/**
 * Fixed-window rate limiter on KV, keyed by client IP (CF-Connecting-IP).
 * NEVER touches D1 — the limiter's only dependency is the RATE_LIMIT KV
 * namespace (enforced by test). KV get/put is not atomic, so a burst can
 * slightly undercount across the read-modify-write; acceptable for coarse
 * abuse limiting (the D1 UNIQUE constraints stay the correctness arbiter).
 */

export interface RateLimitRule {
  /** Namespace for the counter key, e.g. 'form' or 'verify'. */
  scope: string;
  /** Max requests per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/** 5/min/IP for public form POSTs (plan-set starting limit). */
export const FORM_POST_RULE: RateLimitRule = { scope: 'form', limit: 5, windowSeconds: 60 };
/** 20/min/IP for verify POSTs (plan-set starting limit). */
export const VERIFY_POST_RULE: RateLimitRule = { scope: 'verify', limit: 20, windowSeconds: 60 };

interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export async function checkRateLimit(
  kv: KvLike,
  rule: RateLimitRule,
  ip: string,
  now: () => number = Date.now,
): Promise<{ allowed: boolean; remaining: number }> {
  const windowStart = Math.floor(now() / 1000 / rule.windowSeconds);
  const key = `rl:${rule.scope}:${ip}:${windowStart}`;

  const current = Number((await kv.get(key)) ?? '0');
  if (current >= rule.limit) {
    console.log(
      JSON.stringify({ event: 'rate_limit.blocked', scope: rule.scope, ip, count: current }),
    );
    return { allowed: false, remaining: 0 };
  }

  await kv.put(key, String(current + 1), { expirationTtl: rule.windowSeconds * 2 });
  return { allowed: true, remaining: rule.limit - current - 1 };
}
