import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { processLead, d1LeadStore } from '../../lib/enterprise.ts';
import { createMailer, transportFromEnv } from '../../lib/email/mailer.ts';
import { emailLinkBaseUrl } from '../../config';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  processLead(
    {
      store: d1LeadStore(env.DB),
      mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
      notifyEmail: env.SALES_NOTIFY_EMAIL,
      rateLimitKv: env.RATE_LIMIT,
      turnstileSecret: env.TURNSTILE_SECRET,
    },
    request,
  );
