import { beforeEach, describe, expect, it } from 'vitest';
import {
  issueFromQueue,
  refuseFromQueue,
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
  trialDomain: 'acme.com',
  tier: 'trial',
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_000_000 + 14 * 86_400,
  licenseId: 'lic-1',
  queuedAt: 1_700_000_000,
  trialEmail: 'ana@acme.com',
  trialStatus: 'pending_launch',
  alreadyIssued: null,
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
      { store: s.store, env: env(), sendKey: async (_t, _d, k) => void sent.push(k) },
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
      { store: s.store, env: env(), sendKey: async () => void order.push('send') },
      row,
    );
    expect(order).toEqual(['record', 'send']);
  });

  // ⛔ IDEMPOTENCE IS REFUSE, NOT REPLAY. A double-click must not mint twice — two live keys for one
  // customer, neither revocable.
  it('a second decision is REFUSED, and mints nothing', async () => {
    const s = store();
    let mints = 0;
    const deps = { store: s.store, env: env(), sendKey: async () => void (mints += 1) };
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
    const r = await issueFromQueue({ store: s.store, env: env(), sendKey: async () => {} }, row);
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
      { store: s.store, env: env(), sendKey: async () => {} },
      { ...row, trialEmail: null },
    );
    expect(!r.ok && r.code).toBe('no_trial_email');
    expect(s.calls.claims, 'nothing should be claimed for a row that cannot be delivered').toBe(0);
  });

  it('the trial clock starts at issuance, not at queue time', async () => {
    const s = store();
    const now = 1_800_000_000;
    await issueFromQueue(
      { store: s.store, env: env(), sendKey: async () => {}, now: () => now * 1000 },
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
