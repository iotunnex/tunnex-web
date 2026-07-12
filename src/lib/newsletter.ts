import { z } from 'zod';
import { mintToken, hashToken, NEWSLETTER_TOKEN_TTL_SECONDS } from './tokens.ts';
import type { Mailer } from './email/mailer.ts';

/**
 * Newsletter double-opt-in (S2.3). The public endpoint returns the SAME
 * generic response whether the address is new, pending, or already
 * confirmed — no enumeration oracle. Confirmation is scanner-proof: the GET
 * page performs zero writes; only an explicit POST consumes the token,
 * atomically.
 */

export const subscribeInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)),
  turnstileToken: z.string().min(1).max(4096),
});

export const GENERIC_SUBSCRIBE_MESSAGE =
  'If that address checks out, a confirmation email is on its way. The link inside is valid for 24 hours.';

/** Data access the flows need — D1 in production, in-memory in tests. */
export interface SubscriberStore {
  /** Returns confirmed_at (or null) if the subscriber exists, undefined otherwise. */
  getConfirmedAt(email: string): Promise<number | null | undefined>;
  /** Insert or refresh the pending token for an (unconfirmed) subscriber. */
  upsertPendingToken(email: string, tokenHash: string, expiresAt: number): Promise<void>;
  /**
   * Atomic consume: set confirmed_at now and clear the token, but ONLY if the
   * hash matches, is unexpired, and the row is not yet confirmed. Returns the
   * number of rows changed (0 or 1) — the race arbiter.
   */
  confirmAtomic(tokenHash: string, now: number): Promise<number>;
  /** Read-only validity peek for the GET page. ZERO writes. */
  peekToken(tokenHash: string, now: number): Promise<'valid' | 'expired' | 'invalid'>;
}

export async function handleSubscribe(
  deps: { store: SubscriberStore; mailer: Pick<Mailer, 'send'>; baseUrl: string },
  email: string,
  now: () => number = Date.now,
): Promise<void> {
  const confirmedAt = await deps.store.getConfirmedAt(email);
  if (confirmedAt) {
    // Already confirmed: do nothing. The endpoint's response is identical.
    console.log(JSON.stringify({ event: 'subscribe.noop_confirmed' }));
    return;
  }

  const token = await mintToken();
  const expiresAt = Math.floor(now() / 1000) + NEWSLETTER_TOKEN_TTL_SECONDS;
  await deps.store.upsertPendingToken(email, token.hash, expiresAt);

  const confirmUrl = `${deps.baseUrl}/subscribe/confirm?token=${token.raw}`;
  await deps.mailer.send('newsletter-confirm', email, { confirmUrl });
  console.log(JSON.stringify({ event: 'subscribe.confirm_sent' }));
}

export type ConfirmOutcome = 'confirmed' | 'invalid';

export async function handleConfirm(
  deps: { store: SubscriberStore },
  rawToken: string,
  now: () => number = Date.now,
): Promise<ConfirmOutcome> {
  const hash = await hashToken(rawToken);
  const changed = await deps.store.confirmAtomic(hash, Math.floor(now() / 1000));
  if (changed === 1) {
    console.log(JSON.stringify({ event: 'subscribe.confirmed' }));
    return 'confirmed';
  }
  // 0 rows: unknown, expired, or already consumed — deliberately one bucket
  // (page copy handles the just-confirmed race kindly; no status oracle).
  return 'invalid';
}

export async function peekConfirmToken(
  deps: { store: SubscriberStore },
  rawToken: string,
  now: () => number = Date.now,
): Promise<'valid' | 'expired' | 'invalid'> {
  const hash = await hashToken(rawToken);
  return deps.store.peekToken(hash, Math.floor(now() / 1000));
}

/** D1-backed store used by the live endpoints. */
export function d1SubscriberStore(db: D1Database): SubscriberStore {
  return {
    async getConfirmedAt(email) {
      const row = await db
        .prepare('SELECT confirmed_at FROM subscribers WHERE email = ?')
        .bind(email)
        .first<{ confirmed_at: number | null }>();
      return row === null ? undefined : row.confirmed_at;
    },
    async upsertPendingToken(email, tokenHash, expiresAt) {
      await db
        .prepare(
          `INSERT INTO subscribers (email, confirm_token_hash, confirm_token_expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT (email) DO UPDATE SET
             confirm_token_hash = excluded.confirm_token_hash,
             confirm_token_expires_at = excluded.confirm_token_expires_at,
             updated_at = unixepoch()
           WHERE subscribers.confirmed_at IS NULL`,
        )
        .bind(email, tokenHash, expiresAt)
        .run();
    },
    async confirmAtomic(tokenHash, now) {
      const result = await db
        .prepare(
          `UPDATE subscribers SET
             confirmed_at = ?,
             confirm_token_hash = NULL,
             confirm_token_expires_at = NULL,
             updated_at = unixepoch()
           WHERE confirm_token_hash = ?
             AND confirmed_at IS NULL
             AND confirm_token_expires_at > ?`,
        )
        .bind(now, tokenHash, now)
        .run();
      return result.meta.changes ?? 0;
    },
    async peekToken(tokenHash, now) {
      const row = await db
        .prepare(
          'SELECT confirm_token_expires_at, confirmed_at FROM subscribers WHERE confirm_token_hash = ?',
        )
        .bind(tokenHash)
        .first<{ confirm_token_expires_at: number; confirmed_at: number | null }>();
      if (!row) return 'invalid';
      if (row.confirm_token_expires_at <= now) return 'expired';
      return 'valid';
    },
  };
}
