import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { processConfirm } from '../../../lib/newsletter-http.ts';
import { d1SubscriberStore } from '../../../lib/newsletter.ts';
import { createMailer } from '../../../lib/email/mailer.ts';
import { emailLinkBaseUrl } from '../../../config';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  processConfirm(
    {
      store: d1SubscriberStore(env.DB),
      mailer: createMailer({ apiKey: env.RESEND_API_KEY, baseUrl: emailLinkBaseUrl }),
      baseUrl: emailLinkBaseUrl,
      rateLimitKv: env.RATE_LIMIT,
      turnstileSecret: env.TURNSTILE_SECRET,
    },
    request,
  );
