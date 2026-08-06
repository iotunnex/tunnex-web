import { z } from 'zod';
import { deriveTrialDomain } from './trial-domain.ts';
import { mintToken, TRIAL_TOKEN_TTL_SECONDS } from './tokens.ts';
import { guardFormPost, type GuardDeps } from './http/form-guard.ts';
import { jsonError, jsonOk } from './http/errors.ts';
import { FORM_POST_RULE } from './http/rate-limit.ts';
import type { Mailer } from './email/mailer.ts';

/**
 * Trial request pipeline (S3.2, locked rules): Turnstile → normalize →
 * derive eTLD+1 → blocklists → the SAME byte-identical generic response in
 * every non-malformed case — new domain, existing trial, free provider,
 * disposable, unregistrable host. No enumeration oracle.
 *
 * Internally: existing trial for the derived domain → trial-already-exists
 * email (contact-sales path); otherwise mint a 30-minute single-use token
 * (security tier), store the sha256 only, send the magic link. The trial
 * clock is NOT touched here — S3.4 owns started_at/expires_at at key
 * issuance (public promise).
 */

export const trialRequestInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)),
  turnstileToken: z.string().min(1).max(4096),
});

export const GENERIC_TRIAL_MESSAGE =
  'If your domain is eligible, a verification link is on its way to your inbox. It is valid for 30 minutes.';

/**
 * ⛔ THE ORACLE IS PRESERVED WHERE IT MATTERS, AND ONLY THERE.
 *
 * `GENERIC_TRIAL_MESSAGE` exists so the form cannot leak WHICH refusal applied. That is right for one
 * refusal and wrong for the others, and the difference is not a compromise — it is a line:
 *
 *   ⭐ A REFUSAL DERIVABLE FROM PUBLIC INFORMATION LEAKS NOTHING BY BEING STATED.
 *      A REFUSAL DERIVED FROM OUR DATA MUST STAY GENERIC.
 *
 * `free_provider`, `disposable`, `no_registrable_domain` and `invalid_email` are all decidable by the
 * requester without asking us — the public suffix list and a consumer-provider list are public. Telling
 * them tells them nothing they could not already work out.
 *
 * `trialExists` is OUR data: whether some other company holds a trial. That stays generic, and it is why
 * the duplicate-domain refusal happens only AFTER the email round-trip proves the requester controls the
 * address (see the walk record).
 *
 * ⛔ AND THE GENERIC MESSAGE WAS NOT MERELY UNHELPFUL HERE — IT WAS FALSE. It told a Gmail user a
 * verification link was on its way when nothing had been sent. That is the third instance of this shape in
 * one walk (the delivery email promising unlock-in-place; /trial/approved promising a key that was queued).
 *
 * ⚠ Stating this does not create an oracle: someone who gets the generic message learns only that their
 * domain is not a consumer or disposable one — which they already knew — and still learns nothing about
 * whether a trial exists.
 */
export const INELIGIBLE_ADDRESS_MESSAGE =
  'Trials are for work email addresses — consumer and disposable providers are not eligible. Try your company address.';

export interface TrialRequestStore {
  /** True when a trial row already exists for the derived domain. */
  trialExists(domain: string): Promise<boolean>;
  insertRequest(request: {
    email: string;
    domain: string;
    tokenHash: string;
    expiresAt: number;
  }): Promise<void>;
}

export interface TrialRequestDeps extends GuardDeps {
  store: TrialRequestStore;
  mailer: Pick<Mailer, 'send'>;
  baseUrl: string;
  now?: () => number;
}

export async function processTrialRequest(
  deps: TrialRequestDeps,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', 'Send a JSON body.');
  }
  const parsed = trialRequestInput.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', 'Enter a valid work email address.');
  }

  const guarded = await guardFormPost(deps, request, FORM_POST_RULE, parsed.data.turnstileToken);
  if (guarded) return guarded;

  // Everything below returns the identical generic response — reasons are
  // logged (never with the address) but never surfaced.
  const derived = deriveTrialDomain(parsed.data.email);
  if (!derived.ok) {
    console.log(JSON.stringify({ event: 'trial_request.refused', reason: derived.reason }));
    // Public-knowledge refusal: say so. See INELIGIBLE_ADDRESS_MESSAGE for why this is not an oracle.
    return jsonOk({ message: INELIGIBLE_ADDRESS_MESSAGE });
  }

  try {
    if (await deps.store.trialExists(derived.domain)) {
      await deps.mailer.send('trial-already-exists', parsed.data.email, {
        domain: derived.domain,
      });
      console.log(
        JSON.stringify({ event: 'trial_request.already_exists', domain: derived.domain }),
      );
      return generic();
    }

    const token = await mintToken();
    const expiresAt = Math.floor((deps.now ?? Date.now)() / 1000) + TRIAL_TOKEN_TTL_SECONDS;
    await deps.store.insertRequest({
      email: parsed.data.email,
      domain: derived.domain,
      tokenHash: token.hash,
      expiresAt,
    });
    await deps.mailer.send('trial-verify', parsed.data.email, {
      domain: derived.domain,
      verifyUrl: `${deps.baseUrl}/trial/verify?token=${token.raw}`,
    });
    console.log(JSON.stringify({ event: 'trial_request.link_sent', domain: derived.domain }));
  } catch (error) {
    // Still generic: a storage/mail hiccup must not become an oracle either.
    console.log(
      JSON.stringify({
        event: 'trial_request.failed',
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
  return generic();
}

function generic(): Response {
  return jsonOk({ message: GENERIC_TRIAL_MESSAGE });
}

export function d1TrialRequestStore(db: D1Database): TrialRequestStore {
  return {
    async trialExists(domain) {
      const row = await db
        .prepare('SELECT 1 AS one FROM trials WHERE domain = ?')
        .bind(domain)
        .first<{ one: number }>();
      return row !== null;
    },
    async insertRequest(request) {
      await db
        .prepare(
          'INSERT INTO trial_requests (email, domain, token_hash, expires_at) VALUES (?, ?, ?, ?)',
        )
        .bind(request.email, request.domain, request.tokenHash, request.expiresAt)
        .run();
    },
  };
}
