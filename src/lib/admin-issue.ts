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

/** What kind of request a row is (S12.7). Governs what the reviewer may do with it. */
export type QueueKind = 'trial' | 'paid' | 'direct';
export type PaymentState = 'n/a' | 'pending' | 'settled';

export interface QueueRow {
  domain: string;
  /** ⛔ The band that would be MINTED — for a paid row this is what the REVIEWER set, never what was asked. */
  tier: string;
  kind: QueueKind;
  /** What the customer ASKED for. Recorded, shown, and never signed. Null for trial and direct rows. */
  requestedBand: string | null;
  /** ⛔ 'pending' BLOCKS SIGNING. Money is settled offline and the row says whether it has been. */
  paymentState: PaymentState;
  issuedAt: number;
  expiresAt: number;
  licenseId: string;
  queuedAt: number;
  /** From `trials` — what the product already knows about this domain. Null if there is no trial row. */
  trialEmail: string | null;
  trialStatus: string | null;
  /**
   * ⛔ THE DELIVERY ADDRESS, AND IT CANNOT COME FROM `trials` ANY MORE. A paid or direct row has no trial
   * row to join, so a key would be minted with nowhere to send it — `no_trial_email` was already a
   * first-class failure and this is what stops it being the normal case for every paid row.
   */
  contactEmail: string | null;
  /** What the founder needs to price it. Read, never parsed. */
  requestedTermMonths: number | null;
  gateways: number | null;
  company: string | null;
  notes: string | null;
  /**
   * ⛔ EVERY KEY ALREADY ISSUED TO THIS DOMAIN — A COUNT AND THE MOST RECENT, NOT "the" key.
   *
   * ⚠ A domain can have several, and after re-issue exists it usually will. The previous shape read ONE
   * row out of a LEFT JOIN, which quietly duplicated the queue row per issued key and told the reviewer
   * "the prior key" as if a second could not exist. Under offline verification every one of them is still
   * live until its own expiry.
   */
  priorKeys: {
    count: number;
    latest: { licenseId: string; kid: string; band: string; issuedAt: number; expiresAt: number };
  } | null;
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
  /**
   * ⛔ THE PAYMENT GATE, AS A DELIBERATE ACT ON THE ROW. Moves 'pending' → 'settled' and returns false if
   * the row was not pending — so it cannot be replayed, and cannot settle a trial row that has nothing to
   * settle.
   */
  settlePayment(domain: string, at: number): Promise<boolean>;
  /**
   * ⛔ THE REVIEWER SETS THE BAND THAT GETS MINTED. Refuses on a decided row: a band changed after
   * signing would describe a key that does not carry it.
   */
  setBand(domain: string, band: string): Promise<boolean>;
  /**
   * Create a row for a deal closed offline, or a re-issue. ⚠ It is the SAME row shape the request path
   * produces, so there is exactly one path from a decision to a signature.
   */
  createDirect(row: {
    domain: string;
    band: string;
    contactEmail: string;
    termMonths: number;
    issuedAt: number;
    expiresAt: number;
    licenseId: string;
    notes: string;
  }): Promise<'queued' | 'already_open'>;
  /** ⛔ The ledger read: every key ever issued, newest first. */
  ledger(): Promise<LedgerRow[]>;
  recordIssued(row: {
    licenseId: string;
    domain: string;
    band: string;
    kid: string;
    issuedAt: number;
    expiresAt: number;
    licenceKey: string;
    /** ⛔ WHO SIGNED IT — a verified Access identity, never a self-declared name. */
    issuedBy: string;
  }): Promise<void>;
  markEmailed(licenseId: string, at: number): Promise<void>;
  activateTrial(
    domain: string,
    a: { licenseId: string; startedAt: number; expiresAt: number },
  ): Promise<void>;
}

/**
 * A row of the ledger — every key that has ever left this service.
 *
 * ⛔ THERE IS NO `current` FLAG AND THERE NEVER CAN BE. Offline verification means a key runs to its own
 * expiry whatever we do afterwards, so "within term" is a statement about the CLOCK, computed at read
 * time — not a status this service controls or could change.
 */
export interface LedgerRow {
  licenseId: string;
  /** ⚠ Empty for keys minted before the ledger recorded people — an absence, never a guess. */
  issuedBy: string;
  domain: string;
  band: string;
  kid: string;
  issuedAt: number;
  expiresAt: number;
  emailedAt: number | null;
}

/** ⭐ Within term is arithmetic, not state. */
export function withinTerm(row: Pick<LedgerRow, 'issuedAt' | 'expiresAt'>, now: number): boolean {
  return row.issuedAt <= now && now < row.expiresAt;
}

/** Ledger grouped by domain — a customer's whole history in one block, newest key first. */
export function groupByDomain(rows: LedgerRow[]): { domain: string; keys: LedgerRow[] }[] {
  const by = new Map<string, LedgerRow[]>();
  for (const r of rows) by.set(r.domain, [...(by.get(r.domain) ?? []), r]);
  return [...by.entries()]
    .map(([domain, keys]) => ({
      domain,
      keys: [...keys].sort((a, b) => b.issuedAt - a.issuedAt),
    }))
    .sort((a, b) => (b.keys[0]?.issuedAt ?? 0) - (a.keys[0]?.issuedAt ?? 0));
}

export interface AdminIssueDeps {
  store: AdminIssueStore;
  /**
   * ⛔ THE VERIFIED IDENTITY OF THE PERSON PULLING THE TRIGGER. Required, not optional: a signing call
   * that cannot say who made it produces a key nobody can be asked about, and the key cannot be recalled.
   */
  actor: string;
  env: { SIGNING_KEY_JWK?: string; SIGNING_KID?: string; SIGNING_PUBLIC_JWK?: string };
  sendKey(to: string, domain: string, licenceKey: string, expiresAt: number): Promise<void>;
  now?: () => number;
}

/** Error name + message, never a value. */
function errName(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export type IssueOutcome =
  | { ok: true; licenceKey: string; emailed: true }
  /** ⚠ Minted and recorded, but delivery failed. The key is handed BACK — it exists and cannot be recalled. */
  | { ok: true; licenceKey: string; emailed: false; deliveryError: string }
  | {
      ok: false;
      // ⛔ 'sign_failed' USED TO COVER EVERYTHING between reading the secret and producing a signature,
      // and the exception was discarded by a bare `catch {}` — written that way to satisfy no-unused-vars,
      // which deleted the only diagnostic evidence in the system. It cost a live walk to find a cause the
      // exception names in one line. These are separate because the operator's next action differs.
      code:
        | 'not_pending'
        | 'no_trial_email'
        | 'bad_band'
        // ⛔ A PAID ROW WHOSE MONEY HAS NOT ARRIVED. The gate is HERE, not on the button — the queue page
        // is HTML the server sends, and `POST /api/admin/issue` is reachable without it.
        | 'payment_not_settled'
        | 'signing_key_unreadable' // absent, or not JSON — a paste problem
        | 'signing_key_rejected' // parsed, runtime refused it (wrong alg, public half, bad shape)
        | 'signing_threw' // imported fine, signing itself failed
        | 'self_verify_failed';
      detail?: string;
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

  // ⚠ THE ROW'S OWN CONTACT FIRST, `trials` ONLY AS A FALLBACK. A paid or direct row has no trial row to
  // join, and joining one for a domain that happens to have taken a trial would send a purchased key to
  // whoever asked for the free one.
  const to = row.contactEmail ?? row.trialEmail;
  if (!to) return { ok: false, code: 'no_trial_email' };
  if (!isBand(row.tier)) return { ok: false, code: 'bad_band' };

  // ⛔ THE PAYMENT GATE, ON THE SERVER, BEFORE THE CLAIM.
  //
  // The queue page disables the button for an unsettled row — and a disabled button is a statement about a
  // DOM, not about what the endpoint accepts. This is the class fixed in the control plane the same week:
  // a UI gate the server does not mirror is not a gate.
  //
  // ⚠ A trial mistake expires in 30 days. A paid key is a year and CANNOT BE RECALLED, so the first
  // mistake available on this screen is signing before the money arrives.
  if (row.kind === 'paid' && row.paymentState !== 'settled') {
    return { ok: false, code: 'payment_not_settled' };
  }

  if (!(await deps.store.claimForDecision(row.domain, 'issued', now))) {
    return { ok: false, code: 'not_pending' };
  }

  let licenceKey: string;
  let kid: string;
  // ⛔ THE SECRET IS READ AND PARSED SEPARATELY FROM THE IMPORT, so "unreadable" and "rejected" cannot be
  // confused. They have different remedies: one is a paste, the other is the KEY ITSELF being wrong for
  // this runtime — which is exactly what the first live attempt hit (Node exports alg:"Ed25519"; workerd
  // requires "EdDSA").
  if (!deps.env.SIGNING_KEY_JWK || !deps.env.SIGNING_KID) {
    await deps.store.releaseClaim(row.domain);
    return {
      ok: false,
      code: 'signing_key_unreadable',
      detail: 'SIGNING_KEY_JWK or SIGNING_KID is not set',
    };
  }
  try {
    JSON.parse(deps.env.SIGNING_KEY_JWK);
  } catch (e) {
    await deps.store.releaseClaim(row.domain);
    // ⚠ THE MESSAGE ONLY — never the value. A JSON parse error quotes the input it choked on, so the raw
    // text must never reach a log line.
    console.error(JSON.stringify({ event: 'issuance.signing_key_unparseable', error: errName(e) }));
    return {
      ok: false,
      code: 'signing_key_unreadable',
      detail: 'SIGNING_KEY_JWK is not valid JSON',
    };
  }
  try {
    const active = await activeSigningKey(deps.env);
    kid = active.kid;
    // ⚠ CLAIMS ARE REBUILT FROM THE QUEUE ROW, never from anything typed at this screen. The reviewer
    // approves WHAT WAS COMPUTED; a value invented at the signing step is a value nobody reviewed, and
    // under offline verification nobody can take it back.
    const claims: LicenseClaims & { kid: string; band: string } = {
      domain: row.domain,
      tier: row.tier === 'trial' ? 'trial' : 'enterprise',
      seats: null,
      issued_at: now,
      expires_at: now + (row.expiresAt - row.issuedAt), // the reviewed TERM, re-based to the mint moment
      license_id: row.licenseId,
      kid: active.kid,
      band: row.tier,
    };
    licenceKey = await signLicence(active.key, buildPayload(claims));
  } catch (e) {
    await deps.store.releaseClaim(row.domain); // nothing was minted
    // ⛔ LOG THE EXCEPTION. This is the line whose absence cost a live walk: the cause was named exactly by
    // the error text ('JSON Web Key Algorithm parameter "alg" ("Ed25519") does not match requested Ed25519
    // curve') and nothing recorded it.
    // ⚠ Name and message only, and NEITHER can contain key material: WebCrypto import errors describe the
    // ALGORITHM MISMATCH, never the bytes.
    console.error(
      JSON.stringify({ event: 'issuance.sign_failed', domain: row.domain, error: errName(e) }),
    );
    const imported = /import|JSON Web Key|alg|usage|DataError/i.test(errName(e));
    return {
      ok: false,
      code: imported ? 'signing_key_rejected' : 'signing_threw',
      detail: errName(e),
    };
  }

  // 3. Self-verify before it leaves.
  if (deps.env.SIGNING_PUBLIC_JWK) {
    // ⚠ Imported via licence.ts so the algorithm stays confined to one module — the confinement guard
    // caught this when the import was inlined here.
    const pub = await importPublicKey(deps.env.SIGNING_PUBLIC_JWK);
    const check = await verifyLicence({ [kid]: pub }, licenceKey);
    if (!check.ok) {
      await deps.store.releaseClaim(row.domain); // the artefact is broken; nothing usable was issued
      return { ok: false, code: 'self_verify_failed' };
    }
  }

  const expiresAt = now + (row.expiresAt - row.issuedAt);

  // 4. Record BEFORE send.
  try {
    await deps.store.recordIssued({
      licenseId: row.licenseId,
      domain: row.domain,
      band: row.tier,
      kid,
      issuedAt: now,
      expiresAt,
      licenceKey,
      issuedBy: deps.actor,
    });
    // The trial's clock starts at issuance — the public promise. Same activation path the seam already used.
    //
    // ⛔ GATED ON THE KIND, NOT LEFT TO MISS. A paid or direct row has no `trials` row, so this UPDATE
    // would match zero rows and do nothing — harmless, but harmless BECAUSE A WHERE CLAUSE MISSED is not
    // a property anyone stated, and it stops being true the day a paying customer also has a trial row.
    if (row.kind === 'trial') {
      await deps.store.activateTrial(row.domain, {
        licenseId: row.licenseId,
        startedAt: now,
        expiresAt,
      });
    }
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
    await deps.sendKey(to, row.domain, licenceKey, expiresAt);
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
      // ⛔ ONE QUERY, AND PRIOR KEYS ARE AGGREGATED RATHER THAN JOINED ROW-FOR-ROW.
      //
      // ⚠ The previous version was `LEFT JOIN issued_keys k ON k.domain = q.trial_domain` reading ONE key
      // — correct only while a domain could have at most one. Re-issue makes several the normal case, and
      // that join would have DUPLICATED the pending row once per issued key while calling one of them "the
      // prior key". Under offline verification every one of them is live until its own expiry, so the
      // reviewer gets the COUNT and the most recent.
      const { results } = await db
        .prepare(
          `SELECT q.domain, q.tier, q.kind, q.requested_band, q.payment_state,
                  q.issued_at, q.expires_at, q.license_id, q.queued_at, q.contact_email,
                  q.requested_term_months, q.gateways, q.company, q.notes,
                  t.email AS trial_email, t.status AS trial_status,
                  (SELECT count(*) FROM issued_keys k WHERE k.domain = q.domain) AS prior_count,
                  k2.license_id AS issued_license_id, k2.kid AS issued_kid, k2.band AS issued_band,
                  k2.issued_at AS issued_issued_at, k2.expires_at AS issued_expires_at
             FROM licence_review_queue q
             LEFT JOIN trials t ON t.domain = q.domain
             LEFT JOIN issued_keys k2
                    ON k2.id = (SELECT id FROM issued_keys k3 WHERE k3.domain = q.domain
                                 ORDER BY k3.issued_at DESC, k3.id DESC LIMIT 1)
            WHERE q.decided_at IS NULL
            ORDER BY q.queued_at`,
        )
        .all<Record<string, string | number | null>>();
      return (results ?? []).map((r) => ({
        domain: String(r.domain),
        tier: String(r.tier),
        kind: String(r.kind) as QueueKind,
        requestedBand: r.requested_band === null ? null : String(r.requested_band),
        paymentState: String(r.payment_state) as PaymentState,
        issuedAt: Number(r.issued_at),
        expiresAt: Number(r.expires_at),
        licenseId: String(r.license_id),
        queuedAt: Number(r.queued_at),
        contactEmail: r.contact_email === null ? null : String(r.contact_email),
        requestedTermMonths:
          r.requested_term_months === null ? null : Number(r.requested_term_months),
        gateways: r.gateways === null ? null : Number(r.gateways),
        company: r.company === null ? null : String(r.company),
        notes: r.notes === null ? null : String(r.notes),
        trialEmail: r.trial_email === null ? null : String(r.trial_email),
        trialStatus: r.trial_status === null ? null : String(r.trial_status),
        priorKeys:
          r.issued_license_id === null
            ? null
            : {
                count: Number(r.prior_count ?? 1),
                latest: {
                  licenseId: String(r.issued_license_id),
                  kid: String(r.issued_kid),
                  band: String(r.issued_band),
                  issuedAt: Number(r.issued_issued_at),
                  expiresAt: Number(r.issued_expires_at),
                },
              },
      }));
    },

    async settlePayment(domain, at) {
      // The WHERE clause is the arbiter again: only a PENDING paid row moves, so this cannot be replayed
      // and cannot "settle" a trial row that has nothing to settle.
      const res = await db
        .prepare(
          `UPDATE licence_review_queue SET payment_state = 'settled', payment_settled_at = ?
            WHERE domain = ? AND decided_at IS NULL AND payment_state = 'pending'`,
        )
        .bind(at, domain)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    async setBand(domain, band) {
      // ⛔ NOT ON A DECIDED ROW. A band changed after signing would describe a key that does not carry it —
      // and the key cannot be recalled to match.
      const res = await db
        .prepare(`UPDATE licence_review_queue SET tier = ? WHERE domain = ? AND decided_at IS NULL`)
        .bind(band, domain)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    async createDirect(row) {
      const res = await db
        .prepare(
          `INSERT INTO licence_review_queue
             (domain, kind, tier, payment_state, issued_at, expires_at, license_id, contact_email,
              requested_term_months, notes)
           VALUES (?, 'direct', ?, 'n/a', ?, ?, ?, ?, ?, ?)
           ON CONFLICT (domain) WHERE decided_at IS NULL DO NOTHING`,
        )
        .bind(
          row.domain,
          row.band,
          row.issuedAt,
          row.expiresAt,
          row.licenseId,
          row.contactEmail,
          row.termMonths,
          row.notes,
        )
        .run();
      return (res.meta.changes ?? 0) > 0 ? 'queued' : 'already_open';
    },

    async ledger() {
      const { results } = await db
        .prepare(
          `SELECT license_id, domain, band, kid, issued_at, expires_at, emailed_at, issued_by
             FROM issued_keys ORDER BY issued_at DESC, id DESC`,
        )
        .all<Record<string, string | number | null>>();
      return (results ?? []).map((r) => ({
        licenseId: String(r.license_id),
        domain: String(r.domain),
        band: String(r.band),
        kid: String(r.kid),
        issuedAt: Number(r.issued_at),
        expiresAt: Number(r.expires_at),
        emailedAt: r.emailed_at === null ? null : Number(r.emailed_at),
        issuedBy: r.issued_by === null ? '' : String(r.issued_by),
      }));
    },

    async claimForDecision(trialDomain, decision, at) {
      // The WHERE clause IS the arbiter: `decided_at IS NULL` makes a second click change 0 rows.
      const res = await db
        .prepare(
          `UPDATE licence_review_queue SET decided_at = ?, decision = ?
            WHERE domain = ? AND decided_at IS NULL`,
        )
        .bind(at, decision, trialDomain)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    async releaseClaim(trialDomain) {
      await db
        .prepare(
          `UPDATE licence_review_queue SET decided_at = NULL, decision = NULL WHERE domain = ?`,
        )
        .bind(trialDomain)
        .run();
    },

    async recordIssued(row) {
      await db
        .prepare(
          `INSERT INTO issued_keys (license_id, domain, band, kid, issued_at, expires_at, licence_key, issued_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.licenseId,
          row.domain,
          row.band,
          row.kid,
          row.issuedAt,
          row.expiresAt,
          row.licenceKey,
          row.issuedBy,
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
