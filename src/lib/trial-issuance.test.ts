import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onTrialApproved, type TrialActivationStore } from './trial-issuance.ts';
import {
  TRIAL_DAYS,
  TRIAL_SECONDS,
  pendingLaunchIssuer,
  placeholderKeyIssuer,
  type Issuer,
} from './issuance.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const NOW = 1_800_000_000_000; // ms
const nowSec = Math.floor(NOW / 1000);
const now = () => NOW;

function mailerSpy() {
  const sent: { kind: string; to: string; data: Record<string, unknown> }[] = [];
  return {
    sent,
    async send(kind: string, to: string, data: never) {
      sent.push({ kind, to, data });
      return { id: 'msg_test' };
    },
  };
}

function activationSpy() {
  const calls: {
    domain: string;
    activation: { licenseId: string; startedAt: number; expiresAt: number };
  }[] = [];
  const store: TrialActivationStore & { calls: typeof calls } = {
    calls,
    async activateTrial(domain, activation) {
      calls.push({ domain, activation });
    },
  };
  return store;
}

const TRIAL = { domain: 'acme.com', email: 'cto@acme.com' };

describe('onTrialApproved — prelaunch (pendingLaunchIssuer)', () => {
  it('sends trial-approved only; no activation, no clock, no key', async () => {
    const mailer = mailerSpy();
    const activation = activationSpy();
    await onTrialApproved({ issuer: pendingLaunchIssuer(), activation, mailer, now }, TRIAL);

    expect(mailer.sent).toEqual([
      { kind: 'trial-approved', to: 'cto@acme.com', data: { domain: 'acme.com' } },
    ]);
    expect(activation.calls.length).toBe(0);
  });

  it('records the intent (domain + license_id logged, never the email)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await onTrialApproved(
      { issuer: pendingLaunchIssuer(), activation: activationSpy(), mailer: mailerSpy(), now },
      TRIAL,
    );
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('issuance.pending_launch');
    expect(logged).toContain('acme.com');
    expect(logged).not.toContain('cto@acme.com');
  });
});

describe('onTrialApproved — beta path (placeholderKeyIssuer)', () => {
  it('CLOCK STARTS AT ISSUANCE: started_at = now, expires_at = now + 14 days', async () => {
    const activation = activationSpy();
    await onTrialApproved(
      { issuer: placeholderKeyIssuer(), activation, mailer: mailerSpy(), now },
      TRIAL,
    );

    expect(activation.calls.length).toBe(1);
    const { domain, activation: stamped } = activation.calls[0]!;
    expect(domain).toBe('acme.com');
    expect(stamped.startedAt).toBe(nowSec);
    expect(stamped.expiresAt).toBe(nowSec + TRIAL_SECONDS);
    expect(stamped.expiresAt - stamped.startedAt).toBe(TRIAL_DAYS * 86_400);
    expect(stamped.licenseId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends trial-key-delivery with the placeholder key and a human expiry date', async () => {
    const mailer = mailerSpy();
    const activation = activationSpy();
    await onTrialApproved({ issuer: placeholderKeyIssuer(), activation, mailer, now }, TRIAL);

    const sent = mailer.sent[0]!;
    expect(sent.kind).toBe('trial-key-delivery');
    expect(sent.to).toBe('cto@acme.com');
    expect(sent.data.domain).toBe('acme.com');
    expect(sent.data.licenseKey).toBe(
      `TNX-PLACEHOLDER-${activation.calls[0]!.activation.licenseId}`,
    );
    // 1_800_000_000 epoch = 2027-01-15 UTC
    expect(sent.data.expiresAt).toBe('January 29, 2027');
  });

  it('does NOT send trial-approved on the issued path', async () => {
    const mailer = mailerSpy();
    await onTrialApproved(
      { issuer: placeholderKeyIssuer(), activation: activationSpy(), mailer, now },
      TRIAL,
    );
    expect(mailer.sent.map((s) => s.kind)).toEqual(['trial-key-delivery']);
  });
});

describe('Issuer seam', () => {
  it('a custom issuer swaps in without any orchestration change', async () => {
    const custom: Issuer = {
      async issue(claims) {
        expect(claims.tier).toBe('trial');
        expect(claims.seats).toBeNull();
        expect(claims.expires_at - claims.issued_at).toBe(TRIAL_SECONDS);
        return { issued: true, licenseKey: 'REAL-SIGNED-KEY' };
      },
    };
    const mailer = mailerSpy();
    const activation = activationSpy();
    await onTrialApproved({ issuer: custom, activation, mailer, now }, TRIAL);
    expect(mailer.sent[0]!.data.licenseKey).toBe('REAL-SIGNED-KEY');
    expect(activation.calls.length).toBe(1);
  });
});

describe('key material is CONFINED, not absent (ruling replaced 2026-08-06)', () => {
  /**
   * ⛔ THIS GUARD USED TO ASSERT "src/ contains no Ed25519 usage or embedded private keys" — the S3.4 DoD,
   * written when the PLATFORM repo was assumed to hold the signer.
   *
   * THE FOUNDER HAS RULED THE OPPOSITE: the thing that mints keys belongs where the keys are, not where the
   * product ships. The platform repo goes to customers; this one does not.
   *
   * ⭐ SO THE GUARD IS REWRITTEN RATHER THAN DELETED. Deleting it would retire a mechanically-enforced
   * invariant as a side effect of a ruling change, leaving nothing in its place — and this test failing is
   * how the reversal was found to be more than a comment edit. The new invariant is narrower and still
   * checkable:
   *
   *   1. Ed25519 lives in ONE module. A second one is a second place to get signing wrong.
   *   2. A private key is NEVER a literal in source — it is a Worker secret, and `wrangler secret put` is
   *      write-only. A key in source is a key in git, forever, for everyone with clone access.
   */
  const SIGNING_MODULE = 'src/lib/licence.ts';

  const walk = (dir: string, hit: (path: string, text: string) => void) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, hit);
      else if (/\.(ts|astro|mjs|js)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        hit(path, readFileSync(path, 'utf8'));
      }
    }
  };

  // ⚠ SUBJECT NARROWED 2026-08-06, and the reason is the same lesson twice: the old subject was "the
  // string ed25519 appears anywhere", a PROXY for "this file performs Ed25519 crypto". It fired on an
  // operator ERROR MESSAGE that names the algorithm — and that message has to name it, because the whole
  // fix an operator needs is 'Node exports alg:"Ed25519", Workers requires "EdDSA"'.
  //
  // ⛔ THE HAZARD IS A SECOND IMPLEMENTATION, NOT A SECOND MENTION. So the subject is now a crypto.subtle
  // call that names the algorithm — the capability itself. Prose stays free; signing stays confined.
  it(`Ed25519 crypto is PERFORMED only in ${SIGNING_MODULE}`, () => {
    const offenders: string[] = [];
    walk('src', (path, text) => {
      const performs = /crypto\.subtle\.\w+\([^)]*/s.test(text) && /ed25519/i.test(text);
      if (performs && path !== SIGNING_MODULE) offenders.push(path);
    });
    expect(
      offenders,
      'signing belongs in one module — a second one is a second place to get it wrong, and only one of ' +
        'them will have been reviewed as if it mattered',
    ).toEqual([]);
  });

  it('no private key material is embedded anywhere in src/', () => {
    const offenders: string[] = [];
    walk('src', (path, text) => {
      // A PEM block, or a JWK carrying the Ed25519 private scalar `d`. The secret is set with
      // `wrangler secret put` and read from env — it must never be a value in a file.
      if (/BEGIN [A-Z ]*PRIVATE KEY/.test(text)) offenders.push(`${path} (PEM private key)`);
      if (/"kty"\s*:\s*"OKP"[^}]*"d"\s*:/.test(text)) offenders.push(`${path} (private JWK)`);
    });
    expect(
      offenders,
      '⛔ A private key in source is a private key in git — unlimited, unrevocable and undetectable minting ' +
        'for anyone with clone access, forever.',
    ).toEqual([]);
  });
});
