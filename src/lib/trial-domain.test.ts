import { describe, expect, it } from 'vitest';
import { deriveTrialDomain } from './trial-domain.ts';

const ok = (email: string) => {
  const r = deriveTrialDomain(email);
  if (!r.ok) throw new Error(`expected ok for ${email}, got ${r.reason}`);
  return r.domain;
};
const refused = (email: string) => {
  const r = deriveTrialDomain(email);
  if (r.ok) throw new Error(`expected refusal for ${email}, got ${r.domain}`);
  return r.reason;
};

describe('deriveTrialDomain', () => {
  it('derives eTLD+1 and collapses subdomains to the parent', () => {
    expect(ok('a@acme.com')).toBe('acme.com');
    expect(ok('a@eng.acme.com')).toBe('acme.com');
    expect(ok('a@deep.eng.acme.com')).toBe('acme.com');
  });

  it('handles multi-part public suffixes (co.uk and friends)', () => {
    expect(ok('a@example.co.uk')).toBe('example.co.uk');
    expect(ok('a@team.example.co.uk')).toBe('example.co.uk');
    expect(ok('a@example.com.au')).toBe('example.com.au');
    expect(ok('a@example.github.io')).toBe('example.github.io'); // github.io is a public suffix
  });

  it('normalizes case and whitespace', () => {
    expect(ok('  A@ENG.ACME.COM  ')).toBe('acme.com');
  });

  it('refuses hosts with no registrable domain', () => {
    expect(refused('a@com')).toBe('no_registrable_domain');
    expect(refused('a@co.uk')).toBe('no_registrable_domain'); // public suffix only
    expect(refused('a@localhost')).toBe('no_registrable_domain');
    expect(refused('a@192.168.1.1')).toBe('no_registrable_domain');
    expect(refused('a@github.io')).toBe('no_registrable_domain'); // suffix itself
    expect(refused('a@not-a-real-tld-zzz.zzzz')).toBe('no_registrable_domain'); // unlisted TLD
  });

  it('refuses garbage', () => {
    expect(refused('not-an-email')).toBe('invalid_email');
    expect(refused('a@')).toBe('invalid_email');
    expect(refused('@acme.com')).toBe('invalid_email');
    expect(refused('a@acme.com:8080')).toBe('invalid_email');
    expect(refused('a@[2001:db8::1]')).toBe('invalid_email');
    expect(refused('a@acme .com')).toBe('invalid_email');
    expect(refused('a@.acme.com')).toBe('invalid_email');
    expect(refused('a@acme.com.')).toBe('invalid_email');
  });

  it('blocks free providers on the DERIVED domain (subdomains cannot dodge)', () => {
    expect(refused('a@gmail.com')).toBe('free_provider');
    expect(refused('a@anything.gmail.com')).toBe('free_provider'); // derived = gmail.com
    expect(refused('a@GOOGLEMAIL.com')).toBe('free_provider');
    expect(refused('a@proton.me')).toBe('free_provider');
    expect(refused('a@yandex.ru')).toBe('free_provider');
    expect(refused('a@zoho.com')).toBe('free_provider');
    expect(refused('a@mail.com')).toBe('free_provider');
  });

  it('blocks disposable domains on the DERIVED domain', () => {
    expect(refused('a@mailinator.com')).toBe('disposable');
    expect(refused('a@x.mailinator.com')).toBe('disposable');
    expect(refused('a@guerrillamail.com')).toBe('disposable');
    expect(refused('a@10minutemail.com')).toBe('disposable');
  });

  it('accepts ordinary company domains', () => {
    expect(ok('cto@tunnex.io')).toBe('tunnex.io');
    expect(ok('a@sub.corp.example.org')).toBe('example.org');
  });
});
