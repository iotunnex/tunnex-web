import psl from 'psl';
import disposableDomains from 'disposable-email-domains';

/**
 * Trial domain derivation (S3.1, locked rules): ONE trial per company domain,
 * where the domain is DERIVED from the verified work email as eTLD+1 via psl —
 * never split('@')[1], never user-typed. Both blocklists are checked against
 * the DERIVED domain, so a@mail.gmail.com and a@gmail.com collapse to the
 * same refusal, and a@eng.acme.com and a@acme.com collapse to the same trial.
 *
 * The disposable list is inherently incomplete — accepted gap (README).
 */

/** Consumer/free providers — a work-email trial can't bind to these. */
const FREE_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'aol.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'web.de',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
  'zohomail.com',
  'mail.com',
  'mail.ru',
  'fastmail.com',
  'hey.com',
  'tutanota.com',
  'tuta.io',
  'qq.com',
  '163.com',
  '126.com',
]);

const DISPOSABLE = new Set<string>(disposableDomains);

export type TrialDomainResult =
  | { ok: true; domain: string }
  | {
      ok: false;
      reason: 'invalid_email' | 'no_registrable_domain' | 'free_provider' | 'disposable';
    };

export function deriveTrialDomain(email: string): TrialDomainResult {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) {
    return { ok: false, reason: 'invalid_email' };
  }

  const host = normalized.slice(at + 1);
  // psl expects a bare hostname: refuse anything that isn't one (ports,
  // brackets, spaces, IP literals fall out of parse/registrable checks).
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) {
    return { ok: false, reason: 'invalid_email' };
  }

  const parsed = psl.parse(host);
  // psl returns an error object for garbage, and `domain: null` for hosts
  // with no registrable domain (bare TLDs like "com", public-suffix-only
  // hosts like "co.uk", IPs, single labels like "localhost").
  if (parsed.error || !('domain' in parsed) || !parsed.domain || !parsed.listed) {
    return { ok: false, reason: 'no_registrable_domain' };
  }

  const domain = parsed.domain;
  if (FREE_PROVIDERS.has(domain)) return { ok: false, reason: 'free_provider' };
  if (DISPOSABLE.has(domain)) return { ok: false, reason: 'disposable' };

  return { ok: true, domain };
}
