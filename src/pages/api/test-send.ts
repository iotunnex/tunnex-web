// TEMPORARY (gate 1): sends all nine templates through the EMAIL binding so
// the test-send evidence can be captured on a deployed version (the binding
// needs Cloudflare auth, which is CI/deploy-only). Gated by TEST_SEND_KEY.
// Removed after the evidence lands — must not survive into S2.4.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { REPLY_TO, TRANSACTIONAL_FROM, transportFromEnv } from '../../lib/email/mailer.ts';
import { render, type EmailKind, type TemplateDataMap } from '../../lib/email/templates.ts';
import { jsonError, jsonOk } from '../../lib/http/errors.ts';
import { emailLinkBaseUrl } from '../../config';

export const prerender = false;

const input = z.object({ to: z.string().pipe(z.email()) });

const samples: { [K in EmailKind]: TemplateDataMap[K] } = {
  'trial-verify': {
    domain: 'acme.com',
    verifyUrl: `${emailLinkBaseUrl}/trial/verify?token=TEST_SEND_PLACEHOLDER`,
  },
  'trial-already-exists': { domain: 'acme.com' },
  'trial-approved': { domain: 'acme.com' },
  'trial-key-delivery': {
    domain: 'acme.com',
    licenseKey: 'TNX-TRIAL-KEY-PLACEHOLDER',
    expiresAt: 'July 26, 2026',
  },
  'trial-d10-reminder': { domain: 'acme.com', daysLeft: 4, expiresAt: 'July 26, 2026' },
  'trial-expired-upgrade': { domain: 'acme.com' },
  'trial-d21-followup': { domain: 'acme.com' },
  'newsletter-confirm': {
    confirmUrl: `${emailLinkBaseUrl}/subscribe/confirm?token=TEST_SEND_PLACEHOLDER`,
  },
  'enterprise-lead': {
    name: 'Test Send',
    email: 'test@acme.com',
    company: 'Acme Corp',
    seats: '50',
    message: 'Binding test-send of the enterprise lead notification.',
  },
};

export const POST: APIRoute = async ({ request }) => {
  const key = request.headers.get('X-Test-Send-Key');
  if (!env.TEST_SEND_KEY || key !== env.TEST_SEND_KEY) {
    return jsonError(404, 'invalid_request', 'Not found.');
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid_request', 'Send { "to": email }.');

  // Uses the transport directly so the RAW binding error surfaces in the
  // response (this endpoint is key-gated and temporary).
  const transport = transportFromEnv(env);
  const results: { kind: string; id?: string; error?: string }[] = [];
  for (const kind of Object.keys(samples) as EmailKind[]) {
    const { subject, html, text } = render(kind, samples[kind] as never, {
      baseUrl: emailLinkBaseUrl,
    });
    try {
      const { id } = await transport.send({
        from: TRANSACTIONAL_FROM,
        replyTo: REPLY_TO,
        to: parsed.data.to,
        subject,
        html,
        text,
      });
      results.push({ kind, id });
    } catch (error) {
      results.push({ kind, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return jsonOk({ results, bindingPresent: 'EMAIL' in env && Boolean(env.EMAIL) });
};
