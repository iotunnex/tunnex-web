import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { processTrialRequest, d1TrialRequestStore } from '../../../lib/trial-request.ts';
import { createMailer, transportFromEnv } from '../../../lib/email/mailer.ts';
import { emailLinkBaseUrl } from '../../../config';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  processTrialRequest(
    {
      store: d1TrialRequestStore(env.DB),
      mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
      baseUrl: emailLinkBaseUrl,
      rateLimitKv: env.RATE_LIMIT,
      turnstileSecret: env.TURNSTILE_SECRET,
    },
    request,
  );
