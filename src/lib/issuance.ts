/**
 * License issuance boundary (S3.4, ruling replaced 2026-08-06).
 *
 * ⛔ THE PREVIOUS RULING HERE SAID "the site NEVER holds signing keys... no key material in this repo",
 * with the real issuer living beside the product's signer. THAT IS REVERSED, deliberately, and the reason
 * is recorded so this is not read as drift:
 *
 *   That ruling was written when the PLATFORM repo was assumed to hold the signer. The founder has ruled
 *   the opposite — THE THING THAT MINTS KEYS BELONGS WHERE THE KEYS ARE, NOT WHERE THE PRODUCT SHIPS.
 *   The platform repo goes to customers; this repo does not. Different audiences, different release
 *   cadences, different secrets.
 *
 * So the signing key lives HERE, in this repo's Worker secrets, and the Issuer seam stays exactly what it
 * was: the one place that decides whether a licence is minted.
 *
 * ⛔ AND THE SEAM IS WHERE THE HUMAN GATE LIVES — NOT A CALL SITE. Issuance is MANUAL by founder ruling
 * (tunnex platform repo, docs/S12.4-issuance-decisions.md §1): offline verification means there is NO
 * REVOCATION, so an automated mint is a mistake that cannot be taken back.
 *
 * ⚠ `onTrialApproved` has TWO callers — the verify route AND the daily cron's promote leg, which runs
 * unattended in a loop. An issuer that mints would mint at both. Putting the gate at the SEAM makes that
 * true by construction rather than by anyone remembering the second caller exists.
 *
 * `IssuanceResult` already models "not issued" as a first-class outcome and both callers already handle
 * it, which is why the review queue fits here without touching the trial lifecycle.
 */

/** Payload a real issuer signs. Field names follow claims convention. */
export interface LicenseClaims {
  domain: string;
  tier: 'trial' | 'enterprise';
  seats: number | null;
  issued_at: number;
  expires_at: number;
  license_id: string;
}

/**
 * ⛔ TWO STRINGS SPELLED `pending_launch` EXIST, AND THEY ARE NOT THE SAME THING:
 *
 *   - `trials.status = 'pending_launch'`  — a DATABASE value, inside a CHECK constraint
 *   - `IssuanceResult.reason`             — this union, a TypeScript literal
 *
 * ⭐ MOST OF THE "overloaded status" CONFUSION IS THAT COLLISION, NOT THE STATUS ITSELF. Separating the
 * REASON costs nothing and is compiler-checked; renaming the STATUS would mean a CHECK-constraint change,
 * which on SQLite is a create-copy-drop-rename of the table holding every live trial — applied
 * automatically by deploy.yml on push to main. That is the exact cost Shape A was rejected for, and taking
 * it for tidiness would be worse than taking it for a feature.
 *
 * So: `trials.status = 'pending_launch'` keeps meaning exactly what it always meant — PARKED: approved, no
 * key, clock not started — and the reasons below say WHY it is parked.
 */
export type IssuanceResult =
  | { issued: true; licenseKey: string }
  // Waiting for beta launch. The cron's promote leg re-issues with a FRESH clock.
  | { issued: false; reason: 'pending_launch' }
  // ⭐ Waiting for a HUMAN to sign (S12.4 §1: offline verification means no revocation, so an automated
  // mint is a mistake that cannot be taken back). The claims are recorded for review; a person mints.
  // ⚠ Not wired yet — the review queue needs a migration, and that is held.
  | { issued: false; reason: 'pending_review' };

export interface Issuer {
  issue(claims: LicenseClaims): Promise<IssuanceResult>;
}

export const TRIAL_DAYS = 14;
export const TRIAL_SECONDS = TRIAL_DAYS * 86_400;

/**
 * Prelaunch issuer: records the intent and no-ops. The trial stays
 * pending_launch with a NULL clock — the beta-launch pass re-issues with a
 * fresh clock, keeping the public promise (14 days start at key issuance).
 */
export function pendingLaunchIssuer(): Issuer {
  return {
    async issue(claims) {
      console.log(
        JSON.stringify({
          event: 'issuance.pending_launch',
          domain: claims.domain,
          licenseId: claims.license_id,
        }),
      );
      return { issued: false, reason: 'pending_launch' };
    },
  };
}

/**
 * Beta-path stand-in until the product's real signer swaps in: issues an
 * obviously-non-functional placeholder key so the whole activation path
 * (clock writes, key-delivery email) is exercised end to end.
 */
export function placeholderKeyIssuer(): Issuer {
  return {
    async issue(claims) {
      console.log(
        JSON.stringify({
          event: 'issuance.placeholder_issued',
          domain: claims.domain,
          licenseId: claims.license_id,
        }),
      );
      return { issued: true, licenseKey: `TNX-PLACEHOLDER-${claims.license_id}` };
    },
  };
}

// ── the review queue: where manual issuance actually lives ──────────────────────────────────────────

/** Persistence for claims awaiting a human signature. */
export interface ReviewQueueStore {
  /**
   * Record claims for review. MUST be idempotent per domain — both callers can reach the seam more than
   * once for the same trial, and a reviewer should never have to tell two identical rows apart.
   */
  enqueue(claims: LicenseClaims): Promise<void>;
}

/**
 * ⭐ THE ISSUER **IS** THE QUEUE — Shape C, founder-ruled.
 *
 * It records the claims and returns `issued: false`. ⛔ IT NEVER MINTS, AND THAT IS THE WHOLE POINT: the
 * human gate lives HERE, at the seam, not at a call site.
 *
 * ⚠ WHY THE SEAM AND NOT THE CALL SITE. `onTrialApproved` has TWO callers — the verify route, and
 * lifecycle.ts's promote leg driven by the DAILY CRON at 03:17 UTC, unattended, in a loop. A gate placed
 * at one call site proves nothing about the other, and the dangerous one is the cron, where nobody is
 * present. Placing it in the issuer makes the cron safe BY CONSTRUCTION rather than by anyone remembering
 * it exists.
 *
 * The trial stays `status='pending_launch'` — which already means exactly "approved, no key, clock not
 * started" — so no schema state was added and `trials` was not touched.
 */
export function reviewQueueIssuer(store: ReviewQueueStore): Issuer {
  return {
    async issue(claims) {
      await store.enqueue(claims);
      return { issued: false, reason: 'pending_review' };
    },
  };
}

/** D1-backed review queue. Idempotent per domain via UNIQUE(trial_domain) — see migration 0003. */
export function d1ReviewQueueStore(db: D1Database): ReviewQueueStore {
  return {
    async enqueue(claims) {
      await db
        .prepare(
          `INSERT INTO licence_review_queue
             (trial_domain, tier, issued_at, expires_at, license_id)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (trial_domain) DO NOTHING`,
        )
        .bind(
          claims.domain,
          claims.tier,
          claims.issued_at,
          claims.expires_at,
          claims.license_id,
        )
        .run();
    },
  };
}
