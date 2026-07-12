import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GENERIC_SUBSCRIBE_MESSAGE,
  handleConfirm,
  handleSubscribe,
  peekConfirmToken,
  type SubscriberStore,
} from './newsletter.ts';
import { processConfirm, processSubscribe, type NewsletterDeps } from './newsletter-http.ts';
import { hashToken, NEWSLETTER_TOKEN_TTL_SECONDS } from './tokens.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

/** In-memory store mirroring the D1 SQL semantics exactly. */
function memoryStore() {
  interface Row {
    email: string;
    tokenHash: string | null;
    expiresAt: number | null;
    confirmedAt: number | null;
  }
  const rows = new Map<string, Row>();
  const writes: string[] = [];
  const store: SubscriberStore & { rows: Map<string, Row>; writes: string[] } = {
    rows,
    writes,
    async getConfirmedAt(email) {
      const row = rows.get(email);
      return row ? row.confirmedAt : undefined;
    },
    async upsertPendingToken(email, tokenHash, expiresAt) {
      writes.push('upsert');
      const row = rows.get(email);
      if (!row) rows.set(email, { email, tokenHash, expiresAt, confirmedAt: null });
      else if (row.confirmedAt === null) Object.assign(row, { tokenHash, expiresAt });
    },
    async confirmAtomic(tokenHash, now) {
      writes.push('confirm');
      for (const row of rows.values()) {
        if (row.tokenHash === tokenHash && row.confirmedAt === null && (row.expiresAt ?? 0) > now) {
          row.confirmedAt = now;
          row.tokenHash = null;
          row.expiresAt = null;
          return 1;
        }
      }
      return 0;
    },
    async peekToken(tokenHash, now) {
      for (const row of rows.values()) {
        if (row.tokenHash === tokenHash) {
          return (row.expiresAt ?? 0) <= now ? 'expired' : 'valid';
        }
      }
      return 'invalid';
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

function deps(
  store = memoryStore(),
  mailer = mailerSpy(),
): NewsletterDeps & {
  store: ReturnType<typeof memoryStore>;
  mailer: ReturnType<typeof mailerSpy>;
} {
  return {
    store,
    mailer,
    baseUrl: 'https://example.test',
    rateLimitKv: fakeKv(),
    turnstileSecret: 's',
    fetcher: turnstileOk,
  } as never;
}

function subscribeRequest(email: string, ip = '1.2.3.4'): Request {
  return new Request('https://tunnex.io/api/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ email, turnstileToken: 'tok' }),
  });
}

function confirmRequest(token: string, ip = '1.2.3.4'): Request {
  const form = new FormData();
  form.set('token', token);
  return new Request('https://tunnex.io/api/subscribe/confirm', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
    body: form,
  });
}

describe('subscribe', () => {
  it('returns a byte-identical generic response for new, pending, and confirmed emails', async () => {
    const d = deps();
    const first = await (await processSubscribe(d, subscribeRequest('a@acme.com'))).text();
    const second = await (await processSubscribe(d, subscribeRequest('a@acme.com'))).text(); // pending again
    // confirm, then subscribe a third time
    const raw = d.mailer.sent[0]!.data.confirmUrl as string;
    await handleConfirm(d, new URL(raw).searchParams.get('token')!);
    const third = await (await processSubscribe(d, subscribeRequest('a@acme.com'))).text();
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first).toContain(GENERIC_SUBSCRIBE_MESSAGE);
  });

  it('stores only the sha256 hash — never the raw token', async () => {
    const d = deps();
    await handleSubscribe(d, 'a@acme.com');
    const raw = new URL(d.mailer.sent[0]!.data.confirmUrl as string).searchParams.get('token')!;
    const row = d.store.rows.get('a@acme.com')!;
    expect(row.tokenHash).not.toBe(raw);
    expect(row.tokenHash).toBe(await hashToken(raw));
    expect(JSON.stringify([...d.store.rows.values()])).not.toContain(raw);
  });

  it('does not write or send for an already-confirmed address', async () => {
    const d = deps();
    await handleSubscribe(d, 'a@acme.com');
    const raw = new URL(d.mailer.sent[0]!.data.confirmUrl as string).searchParams.get('token')!;
    await handleConfirm(d, raw);
    const writesBefore = d.store.writes.length;
    const sentBefore = d.mailer.sent.length;
    await handleSubscribe(d, 'a@acme.com');
    expect(d.store.writes.length).toBe(writesBefore);
    expect(d.mailer.sent.length).toBe(sentBefore);
  });

  it('rejects invalid email with the uniform shape and never hits the store', async () => {
    const d = deps();
    const res = await processSubscribe(d, subscribeRequest('not-an-email'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(d.store.writes.length).toBe(0);
  });

  it('refuses a failed captcha before touching the store', async () => {
    const d = deps();
    d.fetcher = (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch;
    const res = await processSubscribe(d, subscribeRequest('a@acme.com'));
    expect(res.status).toBe(400);
    expect(d.store.writes.length).toBe(0);
  });

  it('trips the 5/min form limit at the 6th request', async () => {
    const d = deps();
    for (let i = 0; i < 5; i++) {
      expect((await processSubscribe(d, subscribeRequest('a@acme.com'))).status).toBe(200);
    }
    const res = await processSubscribe(d, subscribeRequest('a@acme.com'));
    expect(res.status).toBe(429);
  });
});

describe('confirm', () => {
  async function subscribed() {
    const d = deps();
    await handleSubscribe(d, 'a@acme.com');
    const raw = new URL(d.mailer.sent[0]!.data.confirmUrl as string).searchParams.get('token')!;
    return { d, raw };
  }

  it('GET-page peek performs zero writes (scanner prefetch safe, GET and HEAD)', async () => {
    const { d, raw } = await subscribed();
    const writesBefore = d.store.writes.length;
    // The confirm PAGE only ever calls peekConfirmToken — simulate repeated
    // scanner prefetches (GET + HEAD render the same way).
    for (let i = 0; i < 5; i++) {
      expect(await peekConfirmToken(d, raw)).toBe('valid');
    }
    expect(d.store.writes.length).toBe(writesBefore);
    // still consumable afterwards
    expect(await handleConfirm(d, raw)).toBe('confirmed');
  });

  it('double-POST race: exactly one confirm wins', async () => {
    const { d, raw } = await subscribed();
    const [a, b] = await Promise.all([handleConfirm(d, raw), handleConfirm(d, raw)]);
    expect([a, b].sort()).toEqual(['confirmed', 'invalid']);
    expect(d.store.rows.get('a@acme.com')!.confirmedAt).not.toBeNull();
  });

  it('honors the 24h expiry tier', async () => {
    const { d, raw } = await subscribed();
    const later = Date.now() + (NEWSLETTER_TOKEN_TTL_SECONDS + 60) * 1000;
    expect(await peekConfirmToken(d, raw, () => later)).toBe('expired');
    expect(await handleConfirm(d, raw, () => later)).toBe('invalid');
  });

  it('redirects 303 to /subscribe/confirmed on success and the invalid state otherwise', async () => {
    const { d, raw } = await subscribed();
    const ok = await processConfirm(d, confirmRequest(raw));
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/subscribe/confirmed');
    const again = await processConfirm(d, confirmRequest(raw));
    expect(again.headers.get('location')).toBe('/subscribe/confirm?state=invalid');
  });

  it('applies the 20/min verify limit', async () => {
    const { d } = await subscribed();
    for (let i = 0; i < 20; i++) {
      await processConfirm(d, confirmRequest('x'));
    }
    const res = await processConfirm(d, confirmRequest('x'));
    expect(res.status).toBe(429);
  });
});
