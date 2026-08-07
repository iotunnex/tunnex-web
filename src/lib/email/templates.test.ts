import { describe, expect, it } from 'vitest';
import { render, type EmailKind, type TemplateDataMap } from './templates.ts';

const ctx = { baseUrl: 'https://example.test' };

const cases: { [K in EmailKind]: TemplateDataMap[K] } = {
  'trial-verify': {
    domain: 'acme.com',
    verifyUrl: 'https://example.test/trial/verify?token=RAW_TOKEN_PLACEHOLDER',
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
    confirmUrl: 'https://example.test/subscribe/confirm?token=RAW_TOKEN_PLACEHOLDER',
  },
  'enterprise-lead': {
    name: 'Ada Lovelace',
    email: 'ada@acme.com',
    company: 'Acme Corp',
    seats: '50',
    message: 'We need multi-org for two subsidiaries.',
  },
  'enterprise-lead-ack': {
    name: 'Ada Lovelace',
    company: 'Acme Corp',
  },
  'licence-request-verify': {
    domain: 'acme.com',
    band: 'growth',
    verifyUrl: 'https://example.test/licence/verify?token=RAW_TOKEN_PLACEHOLDER',
  },
  'licence-request-received': { domain: 'acme.com', band: 'growth' },
  'licence-key-delivery': {
    domain: 'acme.com',
    band: 'growth',
    licenseKey: 'TNX-PAID-KEY-PLACEHOLDER',
    expiresAt: 'July 25, 2027',
  },
};

const kinds = Object.keys(cases) as EmailKind[];

describe('email templates', () => {
  for (const kind of kinds) {
    it(`renders ${kind} (html + text snapshot)`, () => {
      const result = render(kind, cases[kind] as never, ctx);
      expect(result.subject.length).toBeGreaterThan(0);
      expect(result.html).toContain('<!doctype html>');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result).toMatchSnapshot();
    });
  }

  it('every template ships an html + plaintext pair with the logo header', () => {
    for (const kind of kinds) {
      const { html, text } = render(kind, cases[kind] as never, ctx);
      expect(html).toContain('/email/tunnex-logo-2x.png');
      expect(html).toContain('alt="Tunnex"');
      expect(text).not.toContain('<');
    }
  });

  it('escapes html in user-controlled fields', () => {
    const { html } = render(
      'enterprise-lead',
      {
        name: '<script>alert(1)</script>',
        email: 'x@x.com',
        company: 'A&B "quotes"',
        seats: '5',
        message: '<img src=x onerror=alert(1)>',
      },
      ctx,
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&amp;B &quot;quotes&quot;');
  });
});
