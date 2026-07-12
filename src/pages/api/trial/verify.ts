import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { processTrialVerify, d1TrialVerifyStore } from '../../../lib/trial-verify.ts';
import { createMailer, transportFromEnv } from '../../../lib/email/mailer.ts';
import { emailLinkBaseUrl } from '../../../config';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  processTrialVerify(
    {
      store: d1TrialVerifyStore(env.DB),
      mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
      rateLimitKv: env.RATE_LIMIT,
    },
    request,
  );
