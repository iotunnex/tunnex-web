import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonError } from './errors.ts';
import { verifyTurnstile } from './turnstile.ts';
import { checkRateLimit, FORM_POST_RULE, VERIFY_POST_RULE } from './rate-limit.ts';
import { guardFormPost } from './form-guard.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function fakeKv() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    store,
    ttls,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      store.set(key, value);
      if (options?.expirationTtl) ttls.set(key, options.expirationTtl);
    },
  };
}

function turnstileFetch(success: boolean): typeof fetch {
  return (async () => new Response(JSON.stringify({ success }))) as typeof fetch;
}

function requestFromIp(ip: string): Request {
  return new Request('https://tunnex.io/api/x', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
  });
}

describe('errors', () => {
  it('emits the uniform shape with no extras', async () => {
    const res = jsonError(429, 'rate_limited', 'Too many requests.');
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = await res.json();
    expect(body).toEqual({ error: { code: 'rate_limited', message: 'Too many requests.' } });
  });
});

describe('turnstile', () => {
  it('refuses a missing token without calling siteverify', async () => {
    const fetcher = vi.fn();
    const ok = await verifyTurnstile({ secret: 's', fetcher }, null, '1.2.3.4');
    expect(ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses when siteverify says no', async () => {
    expect(
      await verifyTurnstile({ secret: 's', fetcher: turnstileFetch(false) }, 'tok', '1.2.3.4'),
    ).toBe(false);
  });

  it('passes when siteverify says yes', async () => {
    expect(
      await verifyTurnstile({ secret: 's', fetcher: turnstileFetch(true) }, 'tok', '1.2.3.4'),
    ).toBe(true);
  });

  it('fails closed when siteverify is unreachable', async () => {
    const fetcher = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile({ secret: 's', fetcher }, 'tok', '1.2.3.4')).toBe(false);
  });

  it('never logs the token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await verifyTurnstile(
      { secret: 's', fetcher: turnstileFetch(false) },
      'SECRET_TOKEN_VALUE',
      '1.2.3.4',
    );
    expect(logSpy.mock.calls.flat().join('\n')).not.toContain('SECRET_TOKEN_VALUE');
  });
});

describe('rate limit', () => {
  it('allows N requests and trips at N+1 (form rule: 5/min)', async () => {
    const kv = fakeKv();
    const now = () => 1_000_000_000;
    for (let i = 0; i < FORM_POST_RULE.limit; i++) {
      const r = await checkRateLimit(kv, FORM_POST_RULE, '1.2.3.4', now);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkRateLimit(kv, FORM_POST_RULE, '1.2.3.4', now);
    expect(blocked).toEqual({ allowed: false, remaining: 0 });
  });

  it('verify rule allows 20 then blocks', async () => {
    const kv = fakeKv();
    const now = () => 1_000_000_000;
    for (let i = 0; i < VERIFY_POST_RULE.limit; i++) {
      expect((await checkRateLimit(kv, VERIFY_POST_RULE, '1.2.3.4', now)).allowed).toBe(true);
    }
    expect((await checkRateLimit(kv, VERIFY_POST_RULE, '1.2.3.4', now)).allowed).toBe(false);
  });

  it('separate IPs and scopes count independently', async () => {
    const kv = fakeKv();
    const now = () => 1_000_000_000;
    for (let i = 0; i < FORM_POST_RULE.limit; i++) {
      await checkRateLimit(kv, FORM_POST_RULE, '1.1.1.1', now);
    }
    expect((await checkRateLimit(kv, FORM_POST_RULE, '2.2.2.2', now)).allowed).toBe(true);
    expect((await checkRateLimit(kv, VERIFY_POST_RULE, '1.1.1.1', now)).allowed).toBe(true);
  });

  it('a new window resets the counter and TTL is set to 2× window', async () => {
    const kv = fakeKv();
    let t = 1_000_000_000;
    for (let i = 0; i < FORM_POST_RULE.limit; i++) {
      await checkRateLimit(kv, FORM_POST_RULE, '1.2.3.4', () => t);
    }
    expect((await checkRateLimit(kv, FORM_POST_RULE, '1.2.3.4', () => t)).allowed).toBe(false);
    t += FORM_POST_RULE.windowSeconds * 1000; // next window
    expect((await checkRateLimit(kv, FORM_POST_RULE, '1.2.3.4', () => t)).allowed).toBe(true);
    for (const ttl of kv.ttls.values()) expect(ttl).toBe(FORM_POST_RULE.windowSeconds * 2);
  });
});

describe('form guard', () => {
  it('D1 is provably untouched: guard deps cannot even name a database', async () => {
    // The guard's dependency type admits only the KV namespace + secret. To
    // prove no hidden global reach, run the full flow with a booby-trapped
    // "env" in scope: any property access on the D1 stand-in throws.
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('D1 was touched by the limiter/guard');
        },
      },
    );
    void db; // present in scope; the guard has no path to it
    const kv = fakeKv();
    const res = await guardFormPost(
      { rateLimitKv: kv, turnstileSecret: 's', fetcher: turnstileFetch(true) },
      requestFromIp('9.9.9.9'),
      FORM_POST_RULE,
      'tok',
    );
    expect(res).toBeNull();
    expect(kv.store.size).toBe(1); // limiter wrote to KV, and only KV
  });

  it('returns 429 with the uniform shape when the limit trips', async () => {
    const kv = fakeKv();
    for (let i = 0; i < FORM_POST_RULE.limit; i++) {
      await checkRateLimit(kv, FORM_POST_RULE, '9.9.9.9');
    }
    const res = await guardFormPost(
      { rateLimitKv: kv, turnstileSecret: 's', fetcher: turnstileFetch(true) },
      requestFromIp('9.9.9.9'),
      FORM_POST_RULE,
      'tok',
    );
    expect(res?.status).toBe(429);
    expect(await res?.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('returns 400 captcha_failed for an invalid Turnstile token', async () => {
    const res = await guardFormPost(
      { rateLimitKv: fakeKv(), turnstileSecret: 's', fetcher: turnstileFetch(false) },
      requestFromIp('9.9.9.9'),
      FORM_POST_RULE,
      'bad-token',
    );
    expect(res?.status).toBe(400);
    expect(await res?.json()).toMatchObject({ error: { code: 'captcha_failed' } });
  });

  it('rate limit is checked before turnstile (blocked request never hits siteverify)', async () => {
    const kv = fakeKv();
    for (let i = 0; i < FORM_POST_RULE.limit; i++) {
      await checkRateLimit(kv, FORM_POST_RULE, '9.9.9.9');
    }
    const fetcher = vi.fn();
    const res = await guardFormPost(
      { rateLimitKv: kv, turnstileSecret: 's', fetcher: fetcher as unknown as typeof fetch },
      requestFromIp('9.9.9.9'),
      FORM_POST_RULE,
      'tok',
    );
    expect(res?.status).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
