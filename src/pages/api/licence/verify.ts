import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handlePaidVerify, d1PaidVerifyStore } from '../../../lib/paid-request.ts';
import { createMailer, transportFromEnv } from '../../../lib/email/mailer.ts';
import { emailLinkBaseUrl } from '../../../config';
import { VERIFY_POST_RULE, checkRateLimit } from '../../../lib/http/rate-limit.ts';

export const prerender = false;

/**
 * POST /api/licence/verify — the explicit consume (form-encoded, no JS needed).
 *
 * ⛔ NO ISSUER IS WIRED HERE AND NONE EVER SHOULD BE. This route runs unattended from a link in an inbox.
 * Offline verification means no revocation, so a mint on this path would be a permanent grant handed out
 * by whoever clicked — the same reasoning that keeps the trial verify holding a DEFERRING issuer. This
 * files a row; a human signs it.
 *
 * ⚠ Token-authenticated, so no Turnstile — same as the trial verify — with the verify-tier rate limit.
 */
export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rate = await checkRateLimit(env.RATE_LIMIT, VERIFY_POST_RULE, ip);
  if (!rate.allowed) {
    return new Response(null, { status: 303, headers: { location: '/licence/verify?state=rate' } });
  }
  const form = await request.formData().catch(() => null);
  const token = form?.get('token');
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    return new Response(null, { status: 303, headers: { location: '/licence/verify?state=invalid' } });
  }

  const outcome = await handlePaidVerify(
    {
      store: d1PaidVerifyStore(env.DB),
      mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
    },
    token,
  );
  // ⭐ `already_open` IS ITS OWN DESTINATION, not folded into a failure. It is the case that used to be
  // discarded silently, and the requester is told plainly that something of theirs is already with us.
  const location =
    outcome === 'queued'
      ? '/licence/verify?state=queued'
      : outcome === 'already_open'
        ? '/licence/verify?state=open'
        : '/licence/verify?state=invalid';
  return new Response(null, { status: 303, headers: { location } });
};
