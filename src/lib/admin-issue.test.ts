import { beforeEach, describe, expect, it } from 'vitest';
import {
  groupByDomain,
  issueFromQueue,
  refuseFromQueue,
  withinTerm,
  type AdminIssueStore,
  type QueueRow,
} from './admin-issue.ts';
import { verifyLicence, importPublicKey } from './licence.ts';

let keys: { priv: string; pub: string; kid: string };

beforeEach(async () => {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  keys = {
    priv: JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey)),
    pub: JSON.stringify(await crypto.subtle.exportKey('jwk', kp.publicKey)),
    kid: 'k-test',
  };
});

const row: QueueRow = {
  domain: 'acme.com',
  tier: 'trial',
  kind: 'trial',
  requestedBand: null,
  paymentState: 'n/a',
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_000_000 + 14 * 86_400,
  licenseId: 'lic-1',
  queuedAt: 1_700_000_000,
  trialEmail: 'ana@acme.com',
  trialStatus: 'pending_launch',
  contactEmail: null,
  requestedTermMonths: null,
  gateways: null,
  company: null,
  notes: null,
  priorKeys: null,
};

/** A PAID row: money outstanding, a band the reviewer set, and its own contact address. */
const paidRow: QueueRow = {
  ...row,
  domain: 'buyer.com',
  kind: 'paid',
  tier: 'starter',
  requestedBand: 'scale',
  paymentState: 'pending',
  licenseId: 'lic-paid',
  trialEmail: null,
  trialStatus: null,
  contactEmail: 'cfo@buyer.com',
  requestedTermMonths: 12,
  gateways: 40,
  company: 'Buyer Ltd',
};

function store(over: Partial<AdminIssueStore> = {}) {
  const calls = { recorded: [] as unknown[], emailed: 0, released: 0, activated: 0, claims: 0 };
  let claimed = false;
  const base: AdminIssueStore = {
    async pendingQueue() {
      return [row];
    },
    async claimForDecision() {
      calls.claims += 1;
      if (claimed) return false; // the arbiter: a second decision changes 0 rows
      claimed = true;
      return true;
    },
    async releaseClaim() {
      calls.released += 1;
      claimed = false;
    },
    async recordIssued(r) {
      calls.recorded.push(r);
    },
    async markEmailed() {
      calls.emailed += 1;
    },
    async activateTrial() {
      calls.activated += 1;
    },
    async settlePayment() {
      return true;
    },
    async setBand() {
      return true;
    },
    async createDirect() {
      return 'queued';
    },
    async ledger() {
      return [];
    },
  };
  return { store: { ...base, ...over }, calls };
}

const env = () => ({
  SIGNING_KEY_JWK: keys.priv,
  SIGNING_KID: keys.kid,
  SIGNING_PUBLIC_JWK: keys.pub,
});

describe('the admin signing surface', () => {
  it('mints a key that verifies against the signing key set', async () => {
    const s = store();
    const sent: string[] = [];
    const r = await issueFromQueue(
      {
        store: s.store,
        env: env(),
        actor: 'ada@tunnex.io',
        sendKey: async (_t, _d, k) => void sent.push(k),
      },
      row,
    );
    expect(r.ok).toBe(true);
    const check = await verifyLicence({ [keys.kid]: await importPublicKey(keys.pub) }, sent[0]);
    expect(check.ok).toBe(true);
    expect(check.ok && check.payload.dom).toBe('acme.com');
  });

  // ⛔ RECORD BEFORE SEND. Send-first plus a failed write mints an unrevocable key with no record that it
  // exists — the whole reason issued_keys is there.
  it('records the key BEFORE sending it', async () => {
    const order: string[] = [];
    const s = store({
      async recordIssued() {
        order.push('record');
      },
    });
    await issueFromQueue(
      {
        store: s.store,
        env: env(),
        actor: 'ada@tunnex.io',
        sendKey: async () => void order.push('send'),
      },
      row,
    );
    expect(order).toEqual(['record', 'send']);
  });

  // ⛔ IDEMPOTENCE IS REFUSE, NOT REPLAY. A double-click must not mint twice — two live keys for one
  // customer, neither revocable.
  it('a second decision is REFUSED, and mints nothing', async () => {
    const s = store();
    let mints = 0;
    const deps = {
      store: s.store,
      env: env(),
      actor: 'ada@tunnex.io',
      sendKey: async () => void (mints += 1),
    };
    const first = await issueFromQueue(deps, row);
    const second = await issueFromQueue(deps, row);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(!second.ok && second.code).toBe('not_pending');
    expect(mints, 'the second click must not produce a second key').toBe(1);
    expect(s.calls.recorded.length).toBe(1);
  });

  // ⚠ A delivery failure hands the key back. It is already minted and unrevocable; losing it helps nobody.
  it('a delivery failure returns the key rather than dropping it', async () => {
    const s = store();
    const r = await issueFromQueue(
      {
        store: s.store,
        env: env(),
        actor: 'ada@tunnex.io',
        sendKey: async () => {
          throw new Error('smtp down');
        },
      },
      row,
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.emailed).toBe(false);
    expect(r.ok && !r.emailed && r.licenceKey).toMatch(/^tnxl_/);
    expect(s.calls.emailed, 'a failed send must not be marked delivered').toBe(0);
  });

  // ⛔ THE UNRECOVERABLE CASE, SURFACED. A key exists and could not be recorded: the claim is NOT released
  // (a retry would mint a second key) and the key is handed over.
  it('a failed record surfaces the key loudly and does NOT release the claim', async () => {
    const s = store({
      async recordIssued() {
        throw new Error('d1 unavailable');
      },
    });
    const r = await issueFromQueue(
      { store: s.store, env: env(), actor: 'ada@tunnex.io', sendKey: async () => {} },
      row,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('minted_but_unrecorded');
    expect(!r.ok && r.code === 'minted_but_unrecorded' && r.licenceKey).toMatch(/^tnxl_/);
    expect(s.calls.released, 'releasing here would let a retry mint a SECOND unrevocable key').toBe(
      0,
    );
  });

  // A broken artefact must not leave, and the claim IS released because nothing usable was issued.
  it('a key that fails self-verification is not issued, and the claim is released', async () => {
    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const s = store();
    const r = await issueFromQueue(
      {
        store: s.store,
        actor: 'ada@tunnex.io',
        // public half belongs to a DIFFERENT key: self-verification must fail
        env: {
          ...env(),
          SIGNING_PUBLIC_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', other.publicKey)),
        },
        sendKey: async () => {},
      },
      row,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('self_verify_failed');
    expect(s.calls.recorded.length).toBe(0);
    expect(s.calls.released, 'nothing usable was issued, so a retry is safe').toBe(1);
  });

  it('a row with no trial email is refused before anything is claimed', async () => {
    const s = store();
    const r = await issueFromQueue(
      { store: s.store, env: env(), actor: 'ada@tunnex.io', sendKey: async () => {} },
      { ...row, trialEmail: null },
    );
    expect(!r.ok && r.code).toBe('no_trial_email');
    expect(s.calls.claims, 'nothing should be claimed for a row that cannot be delivered').toBe(0);
  });

  it('the trial clock starts at issuance, not at queue time', async () => {
    const s = store();
    const now = 1_800_000_000;
    await issueFromQueue(
      {
        store: s.store,
        env: env(),
        actor: 'ada@tunnex.io',
        sendKey: async () => {},
        now: () => now * 1000,
      },
      row,
    );
    const rec = s.calls.recorded[0] as { issuedAt: number; expiresAt: number };
    expect(rec.issuedAt).toBe(now);
    expect(rec.expiresAt - rec.issuedAt, 'the reviewed TERM, re-based to the mint moment').toBe(
      14 * 86_400,
    );
  });

  it('a refusal uses the same arbiter — a second refusal is rejected', async () => {
    const s = store();
    expect((await refuseFromQueue({ store: s.store }, 'acme.com')).ok).toBe(true);
    expect((await refuseFromQueue({ store: s.store }, 'acme.com')).ok).toBe(false);
  });
});

// ⛔ THE PAYMENT GATE IS ON THE SERVER, AND THIS TEST CALLS THE FUNCTION — NOT THE BUTTON.
//
// The queue page renders a disabled control for an unsettled paid row, and a disabled control is a
// statement about a DOM. `POST /api/admin/issue` is reachable without ever loading that page, which is
// exactly the class fixed in the control plane the same week: a UI gate the server does not mirror is not
// a gate at all.
//
// ⚠ AND THE COST IS ASYMMETRIC. A trial mistake expires in 30 days; a paid key is a year and cannot be
// recalled, so signing before the money arrives is the most expensive mistake this screen offers.
describe('paid rows and money', () => {
  it('⛔ REFUSES to sign a paid row whose payment has not settled — and mints nothing', async () => {
    const s = store();
    const sent: string[] = [];
    const r = await issueFromQueue(
      {
        store: s.store,
        env: env(),
        actor: 'ada@tunnex.io',
        sendKey: async (_t, _d, k) => void sent.push(k),
      },
      paidRow,
    );
    expect(r).toEqual({ ok: false, code: 'payment_not_settled' });
    expect(sent).toHaveLength(0);
    expect(s.calls.recorded).toHaveLength(0);
    // ⛔ NOT EVEN CLAIMED. The refusal is BEFORE claim-then-act, so the row stays open for the reviewer to
    // settle and sign — a claimed-then-refused row would need a release nobody triggers.
    expect(s.calls.claims).toBe(0);
  });

  it('signs the same row once the payment is recorded', async () => {
    const s = store();
    const sent: string[] = [];
    const r = await issueFromQueue(
      {
        store: s.store,
        env: env(),
        actor: 'ada@tunnex.io',
        sendKey: async (_t, _d, k) => void sent.push(k),
      },
      { ...paidRow, paymentState: 'settled' },
    );
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  // ⛔ NOBODY GETS SCALE BY ASKING FOR IT. `requestedBand` is recorded so the reviewer can see the gap
  // between the ask and their own decision; the signed claims carry `tier`, which only the reviewer sets.
  it('signs the band the REVIEWER set, never the one that was requested', async () => {
    const s = store();
    const sent: string[] = [];
    await issueFromQueue(
      {
        store: s.store,
        env: env(),
        actor: 'ada@tunnex.io',
        sendKey: async (_t, _d, k) => void sent.push(k),
      },
      { ...paidRow, paymentState: 'settled' }, // asked for scale, reviewer set starter
    );
    const check = await verifyLicence({ [keys.kid]: await importPublicKey(keys.pub) }, sent[0]);
    expect(check.ok && check.payload.band).toBe('starter');
    // ⚠ And the gateway ceiling that rides with it: scale is unlimited, starter is 5. Asserting the band
    // string alone would pass on a payload that priced the customer at the band they asked for.
    expect(check.ok && check.payload.gw).toBe(5);
    expect(s.calls.recorded).toEqual([expect.objectContaining({ band: 'starter' })]);
  });

  // ⚠ A paid row has no `trials` row. Activating one would be a no-op today — and "harmless because a
  // WHERE clause matched nothing" is not a property anyone stated, and stops being true the day a paying
  // customer also has a trial row.
  it('does not touch the trial lifecycle for a paid row', async () => {
    const s = store();
    await issueFromQueue(
      { store: s.store, env: env(), actor: 'ada@tunnex.io', sendKey: async () => {} },
      { ...paidRow, paymentState: 'settled' },
    );
    expect(s.calls.activated).toBe(0);
  });

  it('sends to the row’s own contact, not to whoever took the trial for that domain', async () => {
    const s = store();
    let to = '';
    await issueFromQueue(
      { store: s.store, env: env(), actor: 'ada@tunnex.io', sendKey: async (t) => void (to = t) },
      // A domain that ALSO has a trial row under a different address — the purchased key must not go to
      // whoever asked for the free one.
      { ...paidRow, paymentState: 'settled', trialEmail: 'intern@buyer.com' },
    );
    expect(to).toBe('cfo@buyer.com');
  });
});

// ⛔ THE LEDGER STATES WHAT IS TRUE, AND NOTHING MORE. There is no "current key": offline verification
// means every key runs to its own expiry, so a customer with three keys has three live artefacts until
// three separate dates. Within-term is arithmetic over the clock, not a status this service controls.
describe('the ledger view', () => {
  const k = (domain: string, issuedAt: number, days = 30, band = 'growth') => ({
    licenseId: `${domain}-${issuedAt}`,
    domain,
    band,
    kid: 'k2026',
    issuedAt,
    expiresAt: issuedAt + days * 86_400,
    emailedAt: null,
    issuedBy: 'ada@tunnex.io',
  });

  it('groups every key by domain, newest first, and replaces none of them', () => {
    const groups = groupByDomain([
      k('acme.com', 1_000),
      k('other.com', 5_000),
      k('acme.com', 9_000, 365, 'scale'),
    ]);
    expect(groups.map((g) => g.domain)).toEqual(['acme.com', 'other.com']);
    // ⛔ BOTH of acme's keys survive the grouping. A view that showed "the current one" would be asserting
    // the older key had stopped — which nothing in this system can make true.
    expect(groups[0]?.keys).toHaveLength(2);
    expect(groups[0]?.keys[0]?.band).toBe('scale'); // newest first
  });

  it('within-term is a statement about the clock, both directions', () => {
    const row = k('acme.com', 1_000, 30);
    expect(withinTerm(row, 1_000)).toBe(true);
    expect(withinTerm(row, 1_000 + 29 * 86_400)).toBe(true);
    expect(withinTerm(row, row.expiresAt)).toBe(false); // the boundary is exclusive at the far end
    expect(withinTerm(row, 999)).toBe(false); // and a key does not exist before it was minted
  });
});
