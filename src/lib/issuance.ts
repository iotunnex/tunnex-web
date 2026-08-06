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

export type IssuanceResult =
  { issued: true; licenseKey: string } | { issued: false; reason: 'pending_launch' };

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
