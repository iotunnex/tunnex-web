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

describe('no key material in this repo (S3.4 DoD)', () => {
  it('src/ contains no Ed25519 usage or embedded private keys', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|astro|mjs|js)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          const text = readFileSync(path, 'utf8');
          if (/ed25519|BEGIN [A-Z ]*PRIVATE KEY|signingKey|secret_key/i.test(text)) {
            offenders.push(path);
          }
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
