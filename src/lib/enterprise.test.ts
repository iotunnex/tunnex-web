import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processLead, type LeadDeps, type LeadStore } from './enterprise.ts';
import { FORM_POST_RULE, checkRateLimit } from './http/rate-limit.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function fakeStore() {
  const rows: unknown[] = [];
  const store: LeadStore & { rows: unknown[] } = {
    rows,
    async insert(lead) {
      rows.push(lead);
    },
  };
  return store;
}

function mailerSpy(fail = false) {
  const sent: { kind: string; to: string; data: Record<string, unknown> }[] = [];
  return {
    sent,
    async send(kind: string, to: string, data: never) {
      if (fail) throw new Error('binding down');
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
    notifyEmail: 'sales@tunnex.io',
    rateLimitKv: fakeKv(),
    turnstileSecret: 's',
    fetcher: turnstileOk,
  } as LeadDeps & { store: ReturnType<typeof fakeStore>; mailer: ReturnType<typeof mailerSpy> };
}

function leadRequest(fields: Record<string, string>, ip = '1.2.3.4'): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request('https://tunnex.io/api/enterprise-lead', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
    body: form,
  });
}

const valid = {
  name: 'Ada Lovelace',
  email: 'Ada@Acme.com',
  company: 'Acme Corp',
  seats: '50',
  message: 'Two subsidiaries, need multi-org.',
  'cf-turnstile-response': 'tok',
};

describe('enterprise lead', () => {
  it('happy path: stores the lead, emails sales, redirects to thanks', async () => {
    const d = deps();
    const res = await processLead(d, leadRequest(valid));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/enterprise/thanks');
    expect(d.store.rows[0]).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@acme.com',
      company: 'Acme Corp',
      seats: 50,
      message: 'Two subsidiaries, need multi-org.',
    });
    const sentSales = d.mailer.sent[0]!;
    expect(sentSales.kind).toBe('enterprise-lead');
    expect(sentSales.to).toBe('sales@tunnex.io');
    expect(sentSales.data).toMatchObject({ company: 'Acme Corp', seats: '50' });

    const sentAck = d.mailer.sent[1]!;
    expect(sentAck.kind).toBe('enterprise-lead-ack');
    expect(sentAck.to).toBe('ada@acme.com');
    expect(sentAck.data).toMatchObject({ name: 'Ada Lovelace', company: 'Acme Corp' });
  });

  it('optional fields: seats/message omitted still store and notify', async () => {
    const d = deps();
    const rest = Object.fromEntries(
      Object.entries(valid).filter(([k]) => k !== 'seats' && k !== 'message'),
    );
    const res = await processLead(d, leadRequest(rest));
    expect(res.headers.get('location')).toBe('/enterprise/thanks');
    expect(d.store.rows[0]).toMatchObject({ seats: null, message: '' });
    expect(d.mailer.sent[0]!.data).toMatchObject({
      seats: 'not specified',
      message: '(no message)',
    });
  });

  it('invalid input redirects to the form state and never touches the store', async () => {
    const d = deps();
    const res = await processLead(d, leadRequest({ ...valid, email: 'not-an-email' }));
    expect(res.headers.get('location')).toBe('/enterprise?state=invalid');
    expect(d.store.rows.length).toBe(0);
  });

  it('failed captcha redirects and stores nothing', async () => {
    const d = deps();
    d.fetcher = (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch;
    const res = await processLead(d, leadRequest(valid));
    expect(res.headers.get('location')).toBe('/enterprise?state=captcha');
    expect(d.store.rows.length).toBe(0);
  });

  it('rate limit trips at the 6th request with the rate_limited state', async () => {
    const d = deps();
    for (let i = 0; i < FORM_POST_RULE.limit; i++) {
      await checkRateLimit(d.rateLimitKv, FORM_POST_RULE, '1.2.3.4');
    }
    const res = await processLead(d, leadRequest(valid));
    expect(res.headers.get('location')).toBe('/enterprise?state=rate_limited');
    expect(d.store.rows.length).toBe(0);
  });

  it('a mailer failure never loses the lead — still redirects to thanks', async () => {
    const d = deps(fakeStore(), mailerSpy(true));
    const res = await processLead(d, leadRequest(valid));
    expect(res.headers.get('location')).toBe('/enterprise/thanks');
    expect(d.store.rows.length).toBe(1);
  });
});
