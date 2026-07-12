import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GENERIC_TRIAL_MESSAGE,
  processTrialRequest,
  type TrialRequestDeps,
  type TrialRequestStore,
} from './trial-request.ts';
import { hashToken, TRIAL_TOKEN_TTL_SECONDS } from './tokens.ts';
import { FORM_POST_RULE, checkRateLimit } from './http/rate-limit.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function fakeStore(existingTrialDomains: string[] = []) {
  const requests: { email: string; domain: string; tokenHash: string; expiresAt: number }[] = [];
  const store: TrialRequestStore & { requests: typeof requests } = {
    requests,
    async trialExists(domain) {
      return existingTrialDomains.includes(domain);
    },
    async insertRequest(request) {
      requests.push(request);
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

function fakeKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

const turnstileOk = (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch;

function deps(store = fakeStore(), mailer = mailerSpy()) {
  return {
    store,
    mailer,
    baseUrl: 'https://example.test',
    rateLimitKv: fakeKv(),
    turnstileSecret: 's',
    fetcher: turnstileOk,
  } as TrialRequestDeps & {
    store: ReturnType<typeof fakeStore>;
    mailer: ReturnType<typeof mailerSpy>;
  };
}

function trialRequest(email: string, ip = '1.2.3.4'): Request {
  return new Request('https://tunnex.io/api/trial/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ email, turnstileToken: 'tok' }),
  });
}

describe('trial request', () => {
  it('byte-identical generic response: new / existing-trial / free / disposable / unregistrable', async () => {
    const bodies: string[] = [];
    // new domain
    const d1 = deps();
    bodies.push(await (await processTrialRequest(d1, trialRequest('a@acme.com'))).text());
    // existing trial
    const d2 = deps(fakeStore(['acme.com']));
    bodies.push(await (await processTrialRequest(d2, trialRequest('b@acme.com'))).text());
    // free provider
    bodies.push(await (await processTrialRequest(deps(), trialRequest('a@gmail.com'))).text());
    // disposable
    bodies.push(await (await processTrialRequest(deps(), trialRequest('a@mailinator.com'))).text());
    // no registrable domain (format-valid, unlisted TLD)
    bodies.push(
      await (await processTrialRequest(deps(), trialRequest('a@unregistrable.zzzz'))).text(),
    );

    for (const body of bodies) {
      expect(body).toBe(bodies[0]);
      expect(body).toContain(GENERIC_TRIAL_MESSAGE);
    }
  });

  it('new domain: stores the hash only (30-min tier) and sends the magic link', async () => {
    const d = deps();
    const before = Math.floor(Date.now() / 1000);
    await processTrialRequest(d, trialRequest('cto@ENG.Acme.com'));

    const stored = d.store.requests[0]!;
    expect(stored.domain).toBe('acme.com'); // derived, not the subdomain
    expect(stored.email).toBe('cto@eng.acme.com');
    expect(stored.expiresAt).toBeGreaterThanOrEqual(before + TRIAL_TOKEN_TTL_SECONDS - 2);
    expect(stored.expiresAt).toBeLessThanOrEqual(before + TRIAL_TOKEN_TTL_SECONDS + 5);

    const sent = d.mailer.sent[0]!;
    expect(sent.kind).toBe('trial-verify');
    expect(sent.to).toBe('cto@eng.acme.com');
    const url = new URL(sent.data.verifyUrl as string);
    expect(url.pathname).toBe('/trial/verify');
    const raw = url.searchParams.get('token')!;
    expect(raw.length).toBeGreaterThanOrEqual(42); // 32B base64url
    expect(stored.tokenHash).toBe(await hashToken(raw));
    expect(stored.tokenHash).not.toBe(raw);
    expect(JSON.stringify(d.store.requests)).not.toContain(raw);
  });

  it('existing trial: sends trial-already-exists instead of a link, stores nothing', async () => {
    const d = deps(fakeStore(['acme.com']));
    await processTrialRequest(d, trialRequest('new-person@acme.com'));
    expect(d.store.requests.length).toBe(0);
    const sent = d.mailer.sent[0]!;
    expect(sent.kind).toBe('trial-already-exists');
    expect(sent.data).toMatchObject({ domain: 'acme.com' });
  });

  it('existing trial detected on the DERIVED domain (subdomain request)', async () => {
    const d = deps(fakeStore(['acme.com']));
    await processTrialRequest(d, trialRequest('x@deep.eng.acme.com'));
    expect(d.mailer.sent[0]!.kind).toBe('trial-already-exists');
  });

  it('blocked domains get the generic response with no store write and no email', async () => {
    for (const email of ['a@gmail.com', 'a@x.mailinator.com', 'a@co.uk']) {
      const d = deps();
      const res = await processTrialRequest(d, trialRequest(email));
      expect(res.status).toBe(200);
      expect(d.store.requests.length).toBe(0);
      expect(d.mailer.sent.length).toBe(0);
    }
  });

  it('malformed email is the only non-generic path (400 invalid_request)', async () => {
    const res = await processTrialRequest(deps(), trialRequest('not-an-email'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('failed captcha refused before derivation or store access', async () => {
    const d = deps();
    d.fetcher = (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch;
    const res = await processTrialRequest(d, trialRequest('a@acme.com'));
    expect(res.status).toBe(400);
    expect(d.store.requests.length).toBe(0);
  });

  it('rate limit trips at the 6th request', async () => {
    const d = deps();
    for (let i = 0; i < FORM_POST_RULE.limit; i++) {
      await checkRateLimit(d.rateLimitKv, FORM_POST_RULE, '1.2.3.4');
    }
    expect((await processTrialRequest(d, trialRequest('a@acme.com'))).status).toBe(429);
  });

  it('a mailer failure still returns the generic response (no oracle via errors)', async () => {
    const d = deps();
    d.mailer.send = async () => {
      throw new Error('binding down');
    };
    const res = await processTrialRequest(d, trialRequest('a@acme.com'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(GENERIC_TRIAL_MESSAGE);
  });

  it('never logs the email address or raw token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const d = deps();
    await processTrialRequest(d, trialRequest('secret-person@acme.com'));
    const raw = new URL(d.mailer.sent[0]!.data.verifyUrl as string).searchParams.get('token')!;
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('secret-person');
    expect(logged).not.toContain(raw);
  });
});
