import { z } from 'zod';
import { deriveTrialDomain } from './trial-domain.ts';
import { mintToken, hashToken, TRIAL_TOKEN_TTL_SECONDS } from './tokens.ts';
import { guardFormPost, type GuardDeps } from './http/form-guard.ts';
import { jsonError, jsonOk } from './http/errors.ts';
import { FORM_POST_RULE } from './http/rate-limit.ts';
import type { Mailer } from './email/mailer.ts';

/**
 * The PAID request path (S12.7).
 *
 * ⛔ THE STRUCTURED PATH EXISTED FOR THE FREE THING AND THE PAID THING WENT TO AN INBOX. `/trial` verifies
 * an address, derives an eTLD+1, refuses consumer and disposable providers, and files a reviewable row.
 * "Contact sales" collected a `seats` number the pricing model had already stopped using and wrote it to a
 * table nothing reads.
 *
 * ⚠ SO THIS IS THE TRIAL PIPELINE'S TWIN, DELIBERATELY — same verification, same domain proof, same
 * refusals, same queue. What differs is only what the row means afterwards.
 *
 * ⛔ THE REQUESTER ASKS; THE REVIEWER SETS. `requested_band` is recorded and NEVER signed. Nobody gets
 * Scale by asking for it.
 */

/** Bands a customer can ask for. ⛔ `trial` is not among them — that path already exists and is free. */
export const PAID_BANDS = ['starter', 'growth', 'scale'] as const;
export type PaidBand = (typeof PAID_BANDS)[number];

/** Terms the form offers. Anything else is a conversation, not a form field. */
export const TERM_MONTHS = [12, 24, 36] as const;

export const paidRequestInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)),
  company: z.string().trim().min(1).max(200),
  band: z.enum(PAID_BANDS),
  termMonths: z.coerce
    .number()
    .int()
    .refine((n): n is number => TERM_MONTHS.includes(n as 12)),
  // ⭐ WHAT THE FOUNDER NEEDS TO PRICE IT. Gateways, because that is what Tunnex charges per — the seat
  // question the old lead form asked has not been the pricing model since the per-gateway change.
  gateways: z.coerce.number().int().min(1).max(100_000),
  notes: z.string().trim().max(2000).optional().default(''),
  turnstileToken: z.string().min(1).max(4096),
});

export type PaidRequestInput = z.infer<typeof paidRequestInput>;

export const GENERIC_PAID_MESSAGE =
  'If your domain is eligible, a verification link is on its way to your inbox. It is valid for 30 minutes.';

/**
 * ⛔ THIS ONE IS STATED, AND IT IS THE WHOLE POINT OF THE STORY'S FIRST FINDING.
 *
 * A domain with a request already open is told so. The rule being enforced is "do not queue the same thing
 * twice" — one OPEN request at a time — and it is not "you already had your turn": a settled trial does not
 * block a purchase, which is exactly the case that was silently discarded before.
 *
 * ⚠ AND IT IS NOT AN ORACLE THE TRIAL FORM AVOIDS. The requester has already proven control of an address
 * at this domain by the time they see it — this message is only reachable after the email round-trip.
 */
export const REQUEST_ALREADY_OPEN_MESSAGE =
  'A licence request for this domain is already with us — we will come back to you on it rather than start a second one.';

export const INELIGIBLE_ADDRESS_MESSAGE =
  'Licence requests need a work email address — consumer and disposable providers are not eligible. Try your company address.';

export interface PaidRequestStore {
  insertRequest(request: {
    email: string;
    domain: string;
    tokenHash: string;
    expiresAt: number;
    band: PaidBand;
    termMonths: number;
    gateways: number;
    company: string;
    notes: string;
  }): Promise<void>;
}

export interface PaidRequestDeps extends GuardDeps {
  store: PaidRequestStore;
  mailer: Pick<Mailer, 'send'>;
  baseUrl: string;
  now?: () => number;
}

/** POST /api/licence/request — mints the verification link. Writes nothing reviewable yet. */
export async function processPaidRequest(
  deps: PaidRequestDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', 'Send a JSON body.');
  }
  const parsed = paidRequestInput.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      'invalid_request',
      'Check the form — something is missing or out of range.',
    );
  }

  const guarded = await guardFormPost(deps, request, FORM_POST_RULE, parsed.data.turnstileToken);
  if (guarded) return guarded;

  // ⚠ SAME LINE AS THE TRIAL FORM: a refusal derivable from PUBLIC information leaks nothing by being
  // stated; a refusal derived from OUR data stays generic. The public-suffix and consumer-provider lists
  // are public, so this one is said out loud.
  const derived = deriveTrialDomain(parsed.data.email);
  if (!derived.ok) {
    console.log(JSON.stringify({ event: 'paid_request.refused', reason: derived.reason }));
    return jsonOk({ message: INELIGIBLE_ADDRESS_MESSAGE });
  }

  try {
    const token = await mintToken();
    const expiresAt = Math.floor((deps.now ?? Date.now)() / 1000) + TRIAL_TOKEN_TTL_SECONDS;
    await deps.store.insertRequest({
      email: parsed.data.email,
      domain: derived.domain,
      tokenHash: token.hash,
      expiresAt,
      band: parsed.data.band,
      termMonths: parsed.data.termMonths,
      gateways: parsed.data.gateways,
      company: parsed.data.company,
      notes: parsed.data.notes,
    });
    await deps.mailer.send('licence-request-verify', parsed.data.email, {
      domain: derived.domain,
      band: parsed.data.band,
      verifyUrl: `${deps.baseUrl}/licence/verify?token=${token.raw}`,
    });
    console.log(
      JSON.stringify({
        event: 'paid_request.link_sent',
        domain: derived.domain,
        band: parsed.data.band,
      }),
    );
  } catch (error) {
    // Generic, like the trial form: a storage or mail hiccup must not become an oracle either.
    console.log(
      JSON.stringify({
        event: 'paid_request.failed',
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
  return jsonOk({ message: GENERIC_PAID_MESSAGE });
}

/** What the pre-verification row carried across the email round-trip. */
export interface PendingPaidRequest {
  email: string;
  domain: string;
  expiresAt: number;
  consumedAt: number | null;
  band: PaidBand;
  termMonths: number;
  gateways: number;
  company: string;
  notes: string;
}

export interface PaidVerifyStore {
  peekRequest(tokenHash: string): Promise<PendingPaidRequest | null>;
  consumeAtomic(tokenHash: string, now: number): Promise<number>;
  /**
   * ⛔ Enqueue a PAID row. Returns 'already_open' when the partial unique index refuses it — one OPEN
   * request per domain. A settled row does NOT block: that is the silent-discard fix.
   */
  enqueuePaid(row: {
    domain: string;
    contactEmail: string;
    requestedBand: PaidBand;
    termMonths: number;
    gateways: number;
    company: string;
    notes: string;
    issuedAt: number;
    expiresAt: number;
    licenseId: string;
  }): Promise<'queued' | 'already_open'>;
}

export type PaidVerifyOutcome = 'queued' | 'already_open' | 'invalid';

export interface PaidVerifyDeps {
  store: PaidVerifyStore;
  mailer: Pick<Mailer, 'send'>;
  now?: () => number;
}

const MONTH_SECONDS = 30 * 24 * 60 * 60;

/**
 * Consume the link and file the request for review.
 *
 * ⛔ THE ROW IS QUEUED AT THE BAND THEY ASKED FOR — AS `requested_band`, WHICH IS NOT WHAT GETS SIGNED.
 * `tier` (the band that would be minted) is deliberately seeded to the SMALLEST paid band, so that a
 * reviewer who signs without looking mints the least, not the most. The reviewer sets it explicitly.
 *
 * ⚠ AND THE TERM IS RECORDED, NOT TRUSTED. `expires_at - issued_at` is the term a reviewer sees and can
 * change before signing; the signing step re-bases it to the mint moment, exactly as it does for a trial.
 *
 * ⚠ THE SIGNING FUNCTION IS NOT NAMED IN THIS FILE, AND THAT IS ON PURPOSE. `issuance-gate.test.ts`
 * censuses every file whose TEXT mentions the mint trigger and requires each to be listed with a reason.
 * A prose mention here would have to be answered with an exemption for a file that cannot mint anything —
 * and an exemption granted to make a census quiet is how a census stops meaning anything.
 */
export async function handlePaidVerify(
  deps: PaidVerifyDeps,
  rawToken: string,
  now: () => number = Date.now,
): Promise<PaidVerifyOutcome> {
  if (!rawToken || rawToken.length > 512) return 'invalid';
  const hash = await hashToken(rawToken);
  const request = await deps.store.peekRequest(hash);
  if (!request) return 'invalid';
  const at = Math.floor(now() / 1000);
  if (request.expiresAt <= at) return 'invalid';

  // Arbiter: only one POST per token gets changes === 1.
  if ((await deps.store.consumeAtomic(hash, at)) !== 1) return 'invalid';

  const outcome = await deps.store.enqueuePaid({
    domain: request.domain,
    contactEmail: request.email,
    requestedBand: request.band,
    termMonths: request.termMonths,
    gateways: request.gateways,
    company: request.company,
    notes: request.notes,
    issuedAt: at,
    expiresAt: at + request.termMonths * MONTH_SECONDS,
    licenseId: crypto.randomUUID(),
  });
  if (outcome === 'already_open') {
    console.log(JSON.stringify({ event: 'paid_verify.already_open', domain: request.domain }));
    return 'already_open';
  }
  try {
    await deps.mailer.send('licence-request-received', request.email, {
      domain: request.domain,
      band: request.band,
    });
  } catch (error) {
    // The request is filed; a failed acknowledgement must not lose it.
    console.log(
      JSON.stringify({
        event: 'paid_verify.ack_failed',
        domain: request.domain,
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
  console.log(
    JSON.stringify({
      event: 'paid_verify.queued',
      domain: request.domain,
      requested_band: request.band,
    }),
  );
  return 'queued';
}

export function d1PaidRequestStore(db: D1Database): PaidRequestStore {
  return {
    async insertRequest(r) {
      await db
        .prepare(
          `INSERT INTO trial_requests
             (email, domain, token_hash, expires_at, kind, requested_band, requested_term_months,
              gateways, company, notes)
           VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?)`,
        )
        .bind(
          r.email,
          r.domain,
          r.tokenHash,
          r.expiresAt,
          r.band,
          r.termMonths,
          r.gateways,
          r.company,
          r.notes,
        )
        .run();
    },
  };
}

export function d1PaidVerifyStore(db: D1Database): PaidVerifyStore {
  return {
    async peekRequest(tokenHash) {
      const row = await db
        .prepare(
          `SELECT email, domain, expires_at, consumed_at, requested_band, requested_term_months,
                  gateways, company, notes
             FROM trial_requests WHERE token_hash = ? AND kind = 'paid'`,
        )
        .bind(tokenHash)
        .first<Record<string, string | number | null>>();
      if (!row || row.consumed_at !== null) return null;
      return {
        email: String(row.email),
        domain: String(row.domain),
        expiresAt: Number(row.expires_at),
        consumedAt: null,
        band: String(row.requested_band) as PaidBand,
        termMonths: Number(row.requested_term_months),
        gateways: Number(row.gateways),
        company: String(row.company ?? ''),
        notes: String(row.notes ?? ''),
      };
    },
    async consumeAtomic(tokenHash, now) {
      const res = await db
        .prepare(
          `UPDATE trial_requests SET consumed_at = ?
            WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
        )
        .bind(now, tokenHash, now)
        .run();
      return res.meta.changes ?? 0;
    },
    async enqueuePaid(row) {
      // ⛔ THE CONFLICT TARGET IS THE PARTIAL INDEX, EXPRESSED EXACTLY AS THE INDEX IS. A target that does
      // not match an index is a runtime error here — which is the failure mode worth having, and precisely
      // what the old `ON CONFLICT (trial_domain) DO NOTHING` hid by matching a constraint nobody re-read.
      const res = await db
        .prepare(
          `INSERT INTO licence_review_queue
             (domain, kind, tier, requested_band, payment_state, issued_at, expires_at, license_id,
              contact_email, requested_term_months, gateways, company, notes)
           VALUES (?, 'paid', ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (domain) WHERE decided_at IS NULL DO NOTHING`,
        )
        .bind(
          row.domain,
          // ⭐ SEEDED TO THE SMALLEST PAID BAND, not to what they asked for: a reviewer who signs without
          // looking mints the least, never the most.
          'starter',
          row.requestedBand,
          row.issuedAt,
          row.expiresAt,
          row.licenseId,
          row.contactEmail,
          row.termMonths,
          row.gateways,
          row.company,
          row.notes,
        )
        .run();
      return (res.meta.changes ?? 0) > 0 ? 'queued' : 'already_open';
    },
  };
}
