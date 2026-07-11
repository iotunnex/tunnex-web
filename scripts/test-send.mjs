// Real test-send for the S2.1 DoD: renders a template and sends it via Resend.
// Reads RESEND_API_KEY from .dev.vars (never from argv). Node 22.6+ (type
// stripping) — run with the repo's Node 22+.
//
//   node scripts/test-send.mjs <recipient> [kind]
//
// kind defaults to trial-verify; pass "all" to send every template.
import { readFileSync } from 'node:fs';
import { render } from '../src/lib/email/templates.ts';
import { TRANSACTIONAL_FROM, REPLY_TO } from '../src/lib/email/mailer.ts';

const [to, kindArg = 'trial-verify'] = process.argv.slice(2);
if (!to) {
  console.error('usage: node scripts/test-send.mjs <recipient> [kind|all]');
  process.exit(1);
}

const devVars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const apiKey = devVars.match(/^RESEND_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) {
  console.error('RESEND_API_KEY not found in .dev.vars');
  process.exit(1);
}

const ctx = { baseUrl: 'https://tunnex-site.iotunnex.workers.dev' };
const samples = {
  'trial-verify': {
    domain: 'acme.com',
    verifyUrl: `${ctx.baseUrl}/trial/verify?token=TEST_SEND_PLACEHOLDER`,
  },
  'trial-already-exists': { domain: 'acme.com' },
  'trial-approved': { domain: 'acme.com' },
  'trial-key-delivery': {
    domain: 'acme.com',
    licenseKey: 'TNX-TRIAL-KEY-PLACEHOLDER',
    expiresAt: 'July 25, 2026',
  },
  'trial-d10-reminder': { domain: 'acme.com', daysLeft: 4, expiresAt: 'July 25, 2026' },
  'trial-expired-upgrade': { domain: 'acme.com' },
  'trial-d21-followup': { domain: 'acme.com' },
  'newsletter-confirm': {
    confirmUrl: `${ctx.baseUrl}/subscribe/confirm?token=TEST_SEND_PLACEHOLDER`,
  },
  'enterprise-lead': {
    name: 'Test Send',
    email: 'test@acme.com',
    company: 'Acme Corp',
    seats: '50',
    message: 'Test-send of the enterprise lead notification.',
  },
};

const kinds = kindArg === 'all' ? Object.keys(samples) : [kindArg];
for (const kind of kinds) {
  if (!(kind in samples)) {
    console.error(`unknown kind: ${kind}`);
    process.exit(1);
  }
  const { subject, html, text } = render(kind, samples[kind], ctx);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: TRANSACTIONAL_FROM,
      reply_to: REPLY_TO,
      to,
      subject: `[test-send] ${subject}`,
      html,
      text,
    }),
  });
  const body = await res.json();
  console.log(
    JSON.stringify({ kind, status: res.status, id: body.id ?? null, error: body.message ?? null }),
  );
}
