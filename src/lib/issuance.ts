/**
 * License issuance boundary (S3.4). The site NEVER holds signing keys: the
 * Issuer interface is the seam, and every implementation here either defers
 * (pending launch) or emits an obviously-non-functional placeholder. The real
 * issuer lives with the product's license signer and swaps in as ONE line in
 * the glue (src/pages/api/trial/verify.ts) — no key material in this repo.
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
