import { hashToken } from './tokens.ts';
import { jsonError } from './http/errors.ts';
import { VERIFY_POST_RULE, checkRateLimit, type RateLimitKv } from './http/rate-limit.ts';
import { onTrialApproved, type TrialIssuanceDeps } from './trial-issuance.ts';

/**
 * Trial verification (S3.3, locked rules). Scanner-proof: the GET page peeks
 * validity with ZERO writes; only an explicit POST consumes. Two race
 * arbiters, in order: the atomic consume (UPDATE … WHERE consumed_at IS NULL)
 * kills double-submits of one token; UNIQUE(trials.domain) kills concurrent
 * verifies of different tokens for the same domain. No clock here — the stub
 * in trial-issuance.ts sends the approval email and S3.4 owns
 * started_at/expires_at at key issuance.
 */

export interface TrialVerifyStore {
  /** Read-only lookup for the GET peek. ZERO writes. */
  peekRequest(tokenHash: string): Promise<{
    email: string;
    domain: string;
    expiresAt: number;
    consumedAt: number | null;
  } | null>;
  /**
   * Atomic consume: stamp consumed_at, but ONLY if the hash matches, is
   * unexpired, and not yet consumed. Returns rows changed (0 or 1).
   */
  consumeAtomic(tokenHash: string, now: number): Promise<number>;
  /** INSERT INTO trials — 'conflict' when UNIQUE(domain) already holds a row. */
  insertTrial(domain: string, email: string): Promise<'inserted' | 'conflict'>;
}

export type TrialTokenPeek =
  { state: 'valid'; domain: string } | { state: 'expired' } | { state: 'invalid' };

export async function peekTrialToken(
  deps: { store: TrialVerifyStore },
  rawToken: string,
  now: () => number = Date.now,
): Promise<TrialTokenPeek> {
  if (!rawToken || rawToken.length > 512) return { state: 'invalid' };
  const row = await deps.store.peekRequest(await hashToken(rawToken));
  // Consumed and unknown share one bucket — the page copy handles the
  // just-confirmed race kindly, and there is no status oracle to probe.
  if (!row || row.consumedAt !== null) return { state: 'invalid' };
  if (row.expiresAt <= Math.floor(now() / 1000)) return { state: 'expired' };
  return { state: 'valid', domain: row.domain };
}

export type TrialVerifyOutcome = 'approved' | 'domain_taken' | 'invalid';

export interface TrialVerifyDeps extends TrialIssuanceDeps {
  store: TrialVerifyStore;
}

export async function handleTrialVerify(
  deps: TrialVerifyDeps,
  rawToken: string,
  now: () => number = Date.now,
): Promise<TrialVerifyOutcome> {
  if (!rawToken || rawToken.length > 512) return 'invalid';
  const hash = await hashToken(rawToken);
  const request = await deps.store.peekRequest(hash);
  if (!request) return 'invalid';

  // Arbiter #1: only one POST per token gets changes === 1.
  const changed = await deps.store.consumeAtomic(hash, Math.floor(now() / 1000));
  if (changed !== 1) return 'invalid';

  // Arbiter #2: only one domain verify wins the UNIQUE(domain) insert.
  const inserted = await deps.store.insertTrial(request.domain, request.email);
  if (inserted === 'conflict') {
    console.log(JSON.stringify({ event: 'trial_verify.domain_taken', domain: request.domain }));
    return 'domain_taken';
  }

  try {
    await onTrialApproved(deps, { domain: request.domain, email: request.email });
  } catch (error) {
    // The trial row exists; a failed approval email must not fail the verify.
    console.log(
      JSON.stringify({
        event: 'trial_verify.approval_email_failed',
        domain: request.domain,
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
  console.log(JSON.stringify({ event: 'trial_verify.approved', domain: request.domain }));
  return 'approved';
}

/**
 * POST /api/trial/verify — the explicit consume (form-encoded, no JS needed).
 * Token-authenticated, so no Turnstile; verify-tier rate limit. Redirects:
 * approved → /trial/approved · domain taken → ?state=exists · else ?state=invalid.
 */
export async function processTrialVerify(
  deps: TrialVerifyDeps & { rateLimitKv: RateLimitKv },
  request: Request,
): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rate = await checkRateLimit(deps.rateLimitKv, VERIFY_POST_RULE, ip, deps.now);
  if (!rate.allowed) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
  }

  const form = await request.formData().catch(() => null);
  const token = form?.get('token');
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    return redirect303('/trial/verify?state=invalid');
  }

  const outcome = await handleTrialVerify(deps, token, deps.now);
  return outcome === 'approved'
    ? redirect303('/trial/approved')
    : outcome === 'domain_taken'
      ? redirect303('/trial/verify?state=exists')
      : redirect303('/trial/verify?state=invalid');
}

function redirect303(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

/** D1-backed store used by the live endpoints. */
export function d1TrialVerifyStore(db: D1Database): TrialVerifyStore {
  return {
    async peekRequest(tokenHash) {
      const row = await db
        .prepare(
          'SELECT email, domain, expires_at, consumed_at FROM trial_requests WHERE token_hash = ?',
        )
        .bind(tokenHash)
        .first<{ email: string; domain: string; expires_at: number; consumed_at: number | null }>();
      if (!row) return null;
      return {
        email: row.email,
        domain: row.domain,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
      };
    },
    async consumeAtomic(tokenHash, now) {
      const result = await db
        .prepare(
          `UPDATE trial_requests SET consumed_at = ?
           WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
        )
        .bind(now, tokenHash, now)
        .run();
      return result.meta.changes ?? 0;
    },
    async insertTrial(domain, email) {
      try {
        await db
          .prepare("INSERT INTO trials (domain, email, status) VALUES (?, ?, 'pending_launch')")
          .bind(domain, email)
          .run();
        return 'inserted';
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
          return 'conflict';
        }
        throw error;
      }
    },
  };
}
