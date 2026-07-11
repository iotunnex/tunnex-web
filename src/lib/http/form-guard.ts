import { jsonError } from './errors.ts';
import { verifyTurnstile } from './turnstile.ts';
import { checkRateLimit, type RateLimitRule } from './rate-limit.ts';

/**
 * Shared guard for public form POST endpoints: rate limit first (cheap KV
 * read), then server-side Turnstile verification. Returns an error Response
 * to send as-is, or null when the request may proceed.
 *
 * Deliberately takes ONLY the KV namespace and the Turnstile secret — the
 * guard cannot touch D1 by construction.
 */

export interface GuardDeps {
  rateLimitKv: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  };
  turnstileSecret: string;
  fetcher?: typeof fetch;
}

export async function guardFormPost(
  deps: GuardDeps,
  request: Request,
  rule: RateLimitRule,
  turnstileToken: string | null | undefined,
): Promise<Response | null> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  const rate = await checkRateLimit(deps.rateLimitKv, rule, ip);
  if (!rate.allowed) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
  }

  const human = await verifyTurnstile(
    { secret: deps.turnstileSecret, fetcher: deps.fetcher },
    turnstileToken,
    ip === 'unknown' ? undefined : ip,
  );
  if (!human) {
    return jsonError(400, 'captcha_failed', 'Captcha verification failed. Reload and try again.');
  }

  return null;
}
