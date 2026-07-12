import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleTrialVerify,
  peekTrialToken,
  processTrialVerify,
  type TrialVerifyStore,
} from './trial-verify.ts';
import { hashToken } from './tokens.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const NOW = 1_800_000_000_000; // ms
const nowSec = Math.floor(NOW / 1000);
const now = () => NOW;

/**
 * In-memory store that mirrors the D1 semantics exactly: consumeAtomic is the
 * single-token race arbiter, UNIQUE(trials.domain) the cross-token one. Write
 * counters let the zero-writes tests assert, not assume.
 */
function fakeStore(seed?: { hash: string; email: string; domain: string; expiresAt: number }) {
  const requests = new Map<
    string,
    { email: string; domain: string; expiresAt: number; consumedAt: number | null }
  >();
  if (seed) {
    requests.set(seed.hash, {
      email: seed.email,
      domain: seed.domain,
      expiresAt: seed.expiresAt,
      consumedAt: null,
    });
  }
  const trials: { domain: string; email: string }[] = [];
  let writes = 0;
  const store: TrialVerifyStore & { trials: typeof trials; writes(): number } = {
    trials,
    writes: () => writes,
    async peekRequest(tokenHash) {
      const row = requests.get(tokenHash);
      return row ? { ...row } : null;
    },
    async consumeAtomic(tokenHash, at) {
      writes += 1;
      const row = requests.get(tokenHash);
      if (!row || row.consumedAt !== null || row.expiresAt <= at) return 0;
      row.consumedAt = at;
      return 1;
    },
    async insertTrial(domain, email) {
      writes += 1;
      if (trials.some((t) => t.domain === domain)) return 'conflict';
      trials.push({ domain, email });
      return 'inserted';
    },
  };
  return store;
}

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

async function seeded(overrides?: { expiresAt?: number }) {
  const raw = 'raw-token-abcdefghijklmnopqrstuvwxyz0123456789AB';
  const hash = await hashToken(raw);
  const store = fakeStore({
    hash,
    email: 'cto@acme.com',
    domain: 'acme.com',
    expiresAt: overrides?.expiresAt ?? nowSec + 900,
  });
  const mailer = mailerSpy();
  return { raw, hash, store, mailer, deps: { store, mailer, now } };
}

function fakeKv() {
  const kv = new Map<string, string>();
  return {
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async put(key: string, value: string) {
      kv.set(key, value);
    },
  };
}

function postRequest(token: string | null, ip = '1.2.3.4'): Request {
  const body = new URLSearchParams();
  if (token !== null) body.set('token', token);
  return new Request('https://tunnex.io/api/trial/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
    body,
  });
}

describe('peekTrialToken (GET page — zero writes)', () => {
  it('valid token: reports valid + domain and performs ZERO writes', async () => {
    const { raw, store } = await seeded();
    const peek = await peekTrialToken({ store }, raw, now);
    expect(peek).toEqual({ state: 'valid', domain: 'acme.com' });
    expect(store.writes()).toBe(0);
  });

  it('repeated peeks (scanner prefetch) leave the token consumable', async () => {
    const { raw, store, deps } = await seeded();
    for (let i = 0; i < 5; i++) {
      expect((await peekTrialToken({ store }, raw, now)).state).toBe('valid');
    }
    expect(store.writes()).toBe(0);
    expect(await handleTrialVerify(deps, raw, now)).toBe('approved');
  });

  it('expired token peeks as expired, unknown/consumed as invalid (one bucket)', async () => {
    const expired = await seeded({ expiresAt: nowSec - 1 });
    expect((await peekTrialToken({ store: expired.store }, expired.raw, now)).state).toBe(
      'expired',
    );

    const fresh = await seeded();
    expect((await peekTrialToken({ store: fresh.store }, 'unknown-token', now)).state).toBe(
      'invalid',
    );
    await handleTrialVerify(fresh.deps, fresh.raw, now);
    expect((await peekTrialToken({ store: fresh.store }, fresh.raw, now)).state).toBe('invalid');
  });

  it('empty and oversized tokens are invalid without a store hit', async () => {
    const { store } = await seeded();
    expect((await peekTrialToken({ store }, '', now)).state).toBe('invalid');
    expect((await peekTrialToken({ store }, 'x'.repeat(513), now)).state).toBe('invalid');
    expect(store.writes()).toBe(0);
  });
});

describe('handleTrialVerify (POST consume)', () => {
  it('happy path: consumes, inserts pending_launch trial, sends trial-approved', async () => {
    const { raw, store, mailer, deps } = await seeded();
    expect(await handleTrialVerify(deps, raw, now)).toBe('approved');
    expect(store.trials).toEqual([{ domain: 'acme.com', email: 'cto@acme.com' }]);
    expect(mailer.sent).toEqual([
      { kind: 'trial-approved', to: 'cto@acme.com', data: { domain: 'acme.com' } },
    ]);
  });

  it('expired token: invalid, no trial, no email', async () => {
    const { raw, store, mailer, deps } = await seeded({ expiresAt: nowSec - 1 });
    expect(await handleTrialVerify(deps, raw, now)).toBe('invalid');
    expect(store.trials.length).toBe(0);
    expect(mailer.sent.length).toBe(0);
  });

  it('double-POST of one token: exactly one approved, one email (atomic consume)', async () => {
    const { raw, store, mailer, deps } = await seeded();
    const [first, second] = await Promise.all([
      handleTrialVerify(deps, raw, now),
      handleTrialVerify(deps, raw, now),
    ]);
    expect([first, second].sort()).toEqual(['approved', 'invalid']);
    expect(store.trials.length).toBe(1);
    expect(mailer.sent.length).toBe(1);
  });

  it('concurrent verifies for one domain via different tokens: UNIQUE(domain) arbitrates', async () => {
    const rawA = 'token-a-abcdefghijklmnopqrstuvwxyz0123456789';
    const rawB = 'token-b-abcdefghijklmnopqrstuvwxyz0123456789';
    // two colleagues, both links live for the same domain
    const hashA = await hashToken(rawA);
    const hashB = await hashToken(rawB);
    const seededStore = fakeStore({
      hash: hashA,
      email: 'a@acme.com',
      domain: 'acme.com',
      expiresAt: nowSec + 900,
    });
    // add the second request directly through peek-visible state
    const second = fakeStore({
      hash: hashB,
      email: 'b@acme.com',
      domain: 'acme.com',
      expiresAt: nowSec + 900,
    });
    // merge: one store holding both requests and one trials table
    const merged: TrialVerifyStore & { trials: { domain: string; email: string }[] } = {
      trials: seededStore.trials,
      async peekRequest(h) {
        return (await seededStore.peekRequest(h)) ?? (await second.peekRequest(h));
      },
      async consumeAtomic(h, at) {
        return (await seededStore.consumeAtomic(h, at)) || (await second.consumeAtomic(h, at));
      },
      async insertTrial(domain, email) {
        return seededStore.insertTrial(domain, email); // single trials table = single UNIQUE index
      },
    };
    const mailer = mailerSpy();
    const deps = { store: merged, mailer, now };
    const [a, b] = await Promise.all([
      handleTrialVerify(deps, rawA, now),
      handleTrialVerify(deps, rawB, now),
    ]);
    expect([a, b].sort()).toEqual(['approved', 'domain_taken']);
    expect(merged.trials.length).toBe(1);
    expect(mailer.sent.length).toBe(1); // only the winner gets trial-approved
  });

  it('approval-email failure does not fail the verify (trial row stands)', async () => {
    const { raw, store, mailer, deps } = await seeded();
    mailer.send = async () => {
      throw new Error('binding down');
    };
    expect(await handleTrialVerify(deps, raw, now)).toBe('approved');
    expect(store.trials.length).toBe(1);
  });
});

describe('processTrialVerify (HTTP)', () => {
  it('outcome redirects: approved / exists / invalid', async () => {
    const ok = await seeded();
    const res1 = await processTrialVerify(
      { ...ok.deps, rateLimitKv: fakeKv() },
      postRequest(ok.raw),
    );
    expect(res1.status).toBe(303);
    expect(res1.headers.get('location')).toBe('/trial/approved');

    // same domain, fresh token → exists
    const rawB = 'token-b-abcdefghijklmnopqrstuvwxyz0123456789';
    const hashB = await hashToken(rawB);
    const storeB = fakeStore({
      hash: hashB,
      email: 'b@acme.com',
      domain: 'acme.com',
      expiresAt: nowSec + 900,
    });
    storeB.trials.push({ domain: 'acme.com', email: 'cto@acme.com' });
    const res2 = await processTrialVerify(
      { store: storeB, mailer: mailerSpy(), now, rateLimitKv: fakeKv() },
      postRequest(rawB),
    );
    expect(res2.headers.get('location')).toBe('/trial/verify?state=exists');

    const res3 = await processTrialVerify(
      { ...(await seeded()).deps, rateLimitKv: fakeKv() },
      postRequest('nonsense'),
    );
    expect(res3.headers.get('location')).toBe('/trial/verify?state=invalid');
  });

  it('missing/oversized token redirects invalid without consuming anything', async () => {
    const { store, deps } = await seeded();
    const kv = fakeKv();
    expect(
      (await processTrialVerify({ ...deps, rateLimitKv: kv }, postRequest(null))).headers.get(
        'location',
      ),
    ).toBe('/trial/verify?state=invalid');
    expect(
      (
        await processTrialVerify({ ...deps, rateLimitKv: kv }, postRequest('x'.repeat(513)))
      ).headers.get('location'),
    ).toBe('/trial/verify?state=invalid');
    expect(store.writes()).toBe(0);
  });

  it('verify-tier rate limit trips at the 21st POST', async () => {
    const { deps } = await seeded();
    const kv = fakeKv();
    for (let i = 0; i < 20; i++) {
      await processTrialVerify({ ...deps, rateLimitKv: kv }, postRequest('nonsense'));
    }
    const res = await processTrialVerify({ ...deps, rateLimitKv: kv }, postRequest('nonsense'));
    expect(res.status).toBe(429);
  });

  it('never logs the email address or raw token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { raw, deps } = await seeded();
    await processTrialVerify({ ...deps, rateLimitKv: fakeKv() }, postRequest(raw));
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('cto@acme.com');
    expect(logged).not.toContain(raw);
  });
});
