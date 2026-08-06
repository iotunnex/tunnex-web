import {
  activeSigningKey,
  buildPayload,
  importPublicKey,
  isBand,
  signLicence,
  verifyLicence,
} from './licence.ts';
import type { LicenseClaims } from './issuance.ts';

/**
 * The admin signing surface — the human's actual button.
 *
 * ⛔ THIS IS THE ONLY PATH FROM A QUEUE ROW TO A MINTED KEY. Issuance is manual by founder ruling: Tunnex
 * verifies licences OFFLINE, so there is NO REVOCATION, and an automated mint is a mistake that cannot be
 * taken back. Every other issuer in this codebase defers; this one signs, and only a person reaches it.
 *
 * ⚠ A QUEUE WITH NO REVIEWER IS A CAPABILITY NOBODY CAN REACH. Until this existed, the seam could park
 * work and no operator could act on it — the verb-census class this repo has measured at eleven before.
 */

export interface QueueRow {
  trialDomain: string;
  tier: string;
  issuedAt: number;
  expiresAt: number;
  licenseId: string;
  queuedAt: number;
  /** From `trials` — what the product already knows about this domain. Null if the trial row is gone. */
  trialEmail: string | null;
  trialStatus: string | null;
  /** ⛔ Whether a key has ALREADY been issued to this domain. A second key is a second unrevocable artefact. */
  alreadyIssued: { licenseId: string; kid: string; issuedAt: number; expiresAt: number } | null;
}

export interface AdminIssueStore {
  /** Pending rows, joined against `trials` and `issued_keys` so the reviewer can decide, not just click. */
  pendingQueue(): Promise<QueueRow[]>;
  /**
   * ⛔ CLAIM-THEN-ACT. Atomically flips `decided_at` only when it was NULL; returns false if it was
   * already set. This is the idempotence arbiter — the same shape `claimEmailEvent` uses for cron sends.
   */
  claimForDecision(
    trialDomain: string,
    decision: 'issued' | 'refused',
    at: number,
  ): Promise<boolean>;
  /** Undo a claim. Safe ONLY while no key has been minted — see the ordering note in `issueFromQueue`. */
  releaseClaim(trialDomain: string): Promise<void>;
  recordIssued(row: {
    licenseId: string;
    domain: string;
    band: string;
    kid: string;
    issuedAt: number;
    expiresAt: number;
    licenceKey: string;
  }): Promise<void>;
  markEmailed(licenseId: string, at: number): Promise<void>;
  activateTrial(
    domain: string,
    a: { licenseId: string; startedAt: number; expiresAt: number },
  ): Promise<void>;
}

export interface AdminIssueDeps {
  store: AdminIssueStore;
  env: { SIGNING_KEY_JWK?: string; SIGNING_KID?: string; SIGNING_PUBLIC_JWK?: string };
  sendKey(to: string, domain: string, licenceKey: string, expiresAt: number): Promise<void>;
  now?: () => number;
}

export type IssueOutcome =
  | { ok: true; licenceKey: string; emailed: true }
  /** ⚠ Minted and recorded, but delivery failed. The key is handed BACK — it exists and cannot be recalled. */
  | { ok: true; licenceKey: string; emailed: false; deliveryError: string }
  | {
      ok: false;
      code: 'not_pending' | 'no_trial_email' | 'bad_band' | 'sign_failed' | 'self_verify_failed';
    }
  /** ⛔ The unrecoverable case: a key EXISTS and we failed to record it. Surfaced loudly, never swallowed. */
  | { ok: false; code: 'minted_but_unrecorded'; licenceKey: string; detail: string };

/**
 * Sign one queue row.
 *
 * ⛔ IDEMPOTENCE: **REFUSE, NOT REPLAY.** A second click gets `not_pending` — it does NOT return the first
 * key and it does NOT mint another.
 *
 *   Why refuse rather than replay: replaying would mean reading back and re-sending a key on a request that
 *   looks identical to the one that minted it, which makes "did this mint?" unanswerable from the call
 *   site. Why refuse rather than mint again: two keys for one customer, both live, NEITHER REVOCABLE.
 *   Refusing is the only option where the operator can tell what happened.
 *
 * ORDERING, and each step is placed for a reason that costs something if moved:
 *
 *   1. CLAIM the row (atomic). Nothing else can be in flight for this domain.
 *   2. MINT.
 *   3. SELF-VERIFY against the same key set — a key that does not verify cannot be recalled and is
 *      invisible from the customer's side; they simply cannot activate and we have no record it was wrong.
 *   4. RECORD in `issued_keys` — ⛔ BEFORE SENDING. Send-first plus a failed write mints an unrevocable key
 *      with no record that it exists, which is the whole reason the ledger is there.
 *   5. SEND. A delivery failure returns the key to the operator rather than dropping it.
 *
 * ⚠ Steps 2–3 failing RELEASE the claim: no key exists, so a retry is safe. Step 4 failing does NOT
 * release it — a key has been minted, and a retry would mint a second one.
 */
export async function issueFromQueue(deps: AdminIssueDeps, row: QueueRow): Promise<IssueOutcome> {
  const now = Math.floor((deps.now ?? Date.now)() / 1000);

  if (!row.trialEmail) return { ok: false, code: 'no_trial_email' };
  if (!isBand(row.tier)) return { ok: false, code: 'bad_band' };

  if (!(await deps.store.claimForDecision(row.trialDomain, 'issued', now))) {
    return { ok: false, code: 'not_pending' };
  }

  let licenceKey: string;
  let kid: string;
  try {
    const active = await activeSigningKey(deps.env);
    kid = active.kid;
    // ⚠ CLAIMS ARE REBUILT FROM THE QUEUE ROW, never from anything typed at this screen. The reviewer
    // approves WHAT WAS COMPUTED; a value invented at the signing step is a value nobody reviewed, and
    // under offline verification nobody can take it back.
    const claims: LicenseClaims & { kid: string; band: string } = {
      domain: row.trialDomain,
      tier: row.tier === 'trial' ? 'trial' : 'enterprise',
      seats: null,
      issued_at: now,
      expires_at: now + (row.expiresAt - row.issuedAt), // the reviewed TERM, re-based to the mint moment
      license_id: row.licenseId,
      kid: active.kid,
      band: row.tier,
    };
    licenceKey = await signLicence(active.key, buildPayload(claims));
  } catch {
    await deps.store.releaseClaim(row.trialDomain); // nothing was minted
    return { ok: false, code: 'sign_failed' };
  }

  // 3. Self-verify before it leaves.
  if (deps.env.SIGNING_PUBLIC_JWK) {
    // ⚠ Imported via licence.ts so the algorithm stays confined to one module — the confinement guard
    // caught this when the import was inlined here.
    const pub = await importPublicKey(deps.env.SIGNING_PUBLIC_JWK);
    const check = await verifyLicence({ [kid]: pub }, licenceKey);
    if (!check.ok) {
      await deps.store.releaseClaim(row.trialDomain); // the artefact is broken; nothing usable was issued
      return { ok: false, code: 'self_verify_failed' };
    }
  }

  const expiresAt = now + (row.expiresAt - row.issuedAt);

  // 4. Record BEFORE send.
  try {
    await deps.store.recordIssued({
      licenseId: row.licenseId,
      domain: row.trialDomain,
      band: row.tier,
      kid,
      issuedAt: now,
      expiresAt,
      licenceKey,
    });
    // The trial's clock starts at issuance — the public promise. Same activation path the seam already used.
    await deps.store.activateTrial(row.trialDomain, {
      licenseId: row.licenseId,
      startedAt: now,
      expiresAt,
    });
  } catch (e) {
    // ⛔ A KEY EXISTS AND WE COULD NOT RECORD IT. The claim is deliberately NOT released: retrying would
    // mint a second unrevocable key. Hand the key over and say plainly what happened — this is the one
    // state that needs a human to reconcile, and it must never be swallowed into a generic failure.
    return {
      ok: false,
      code: 'minted_but_unrecorded',
      licenceKey,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // 5. Send.
  try {
    await deps.sendKey(row.trialEmail, row.trialDomain, licenceKey, expiresAt);
  } catch (e) {
    return {
      ok: true,
      licenceKey,
      emailed: false,
      deliveryError: e instanceof Error ? e.message : String(e),
    };
  }
  await deps.store.markEmailed(row.licenseId, now);
  return { ok: true, licenceKey, emailed: true };
}

/** Decline a queue row. Same claim-then-act arbiter, so a double-click cannot refuse an issued row. */
export async function refuseFromQueue(
  deps: Pick<AdminIssueDeps, 'store' | 'now'>,
  trialDomain: string,
): Promise<{ ok: boolean }> {
  const now = Math.floor((deps.now ?? Date.now)() / 1000);
  return { ok: await deps.store.claimForDecision(trialDomain, 'refused', now) };
}

/** D1-backed admin store. */
export function d1AdminIssueStore(db: D1Database): AdminIssueStore {
  return {
    async pendingQueue() {
      // ⛔ ONE QUERY, THREE FACTS. The reviewer needs what was asked for, what `trials` already knows, and
      // — decisively — whether a key has ALREADY been issued to this domain. A second key is a second
      // unrevocable artefact, and the ledger is the only thing that can say.
      const { results } = await db
        .prepare(
          `SELECT q.trial_domain, q.tier, q.issued_at, q.expires_at, q.license_id, q.queued_at,
                  t.email AS trial_email, t.status AS trial_status,
                  k.license_id AS issued_license_id, k.kid AS issued_kid,
                  k.issued_at AS issued_issued_at, k.expires_at AS issued_expires_at
             FROM licence_review_queue q
             LEFT JOIN trials t ON t.domain = q.trial_domain
             LEFT JOIN issued_keys k ON k.domain = q.trial_domain
            WHERE q.decided_at IS NULL
            ORDER BY q.queued_at`,
        )
        .all<Record<string, string | number | null>>();
      return (results ?? []).map((r) => ({
        trialDomain: String(r.trial_domain),
        tier: String(r.tier),
        issuedAt: Number(r.issued_at),
        expiresAt: Number(r.expires_at),
        licenseId: String(r.license_id),
        queuedAt: Number(r.queued_at),
        trialEmail: r.trial_email === null ? null : String(r.trial_email),
        trialStatus: r.trial_status === null ? null : String(r.trial_status),
        alreadyIssued:
          r.issued_license_id === null
            ? null
            : {
                licenseId: String(r.issued_license_id),
                kid: String(r.issued_kid),
                issuedAt: Number(r.issued_issued_at),
                expiresAt: Number(r.issued_expires_at),
              },
      }));
    },

    async claimForDecision(trialDomain, decision, at) {
      // The WHERE clause IS the arbiter: `decided_at IS NULL` makes a second click change 0 rows.
      const res = await db
        .prepare(
          `UPDATE licence_review_queue SET decided_at = ?, decision = ?
            WHERE trial_domain = ? AND decided_at IS NULL`,
        )
        .bind(at, decision, trialDomain)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    async releaseClaim(trialDomain) {
      await db
        .prepare(
          `UPDATE licence_review_queue SET decided_at = NULL, decision = NULL WHERE trial_domain = ?`,
        )
        .bind(trialDomain)
        .run();
    },

    async recordIssued(row) {
      await db
        .prepare(
          `INSERT INTO issued_keys (license_id, domain, band, kid, issued_at, expires_at, licence_key)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.licenseId,
          row.domain,
          row.band,
          row.kid,
          row.issuedAt,
          row.expiresAt,
          row.licenceKey,
        )
        .run();
    },

    async markEmailed(licenseId, at) {
      await db
        .prepare(`UPDATE issued_keys SET emailed_at = ? WHERE license_id = ?`)
        .bind(at, licenseId)
        .run();
    },

    async activateTrial(domain, a) {
      await db
        .prepare(
          `UPDATE trials SET status = 'active', license_id = ?, started_at = ?, expires_at = ?
            WHERE domain = ? AND status = 'pending_launch'`,
        )
        .bind(a.licenseId, a.startedAt, a.expiresAt, domain)
        .run();
    },
  };
}
