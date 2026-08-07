import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { processPaidRequest, d1PaidRequestStore } from '../../../lib/paid-request.ts';
import { createMailer, transportFromEnv } from '../../../lib/email/mailer.ts';
import { emailLinkBaseUrl } from '../../../config';

export const prerender = false;

/**
 * POST /api/licence/request — the paid path's front door.
 *
 * ⚠ THE TRIAL ROUTE'S TWIN, and deliberately identical in every control: same Turnstile, same rate-limit
 * rule, same domain derivation. The paid path is not a lighter-weight one because money is involved.
 */
export const POST: APIRoute = ({ request }) =>
  processPaidRequest(
    {
      store: d1PaidRequestStore(env.DB),
      mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
      baseUrl: emailLinkBaseUrl,
      rateLimitKv: env.RATE_LIMIT,
      turnstileSecret: env.TURNSTILE_SECRET,
    },
    request,
  );
