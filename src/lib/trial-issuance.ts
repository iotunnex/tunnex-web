import type { Mailer } from './email/mailer.ts';
import { TRIAL_SECONDS, type Issuer, type LicenseClaims } from './issuance.ts';

/**
 * Trial approval → issuance orchestration (S3.4 wires what S3.3 stubbed).
 *
 * The public promise: the trial clock starts at KEY ISSUANCE. So the clock
 * (status='active', started_at, expires_at) is written HERE, only when the
 * injected Issuer actually issues. The pendingLaunchIssuer declines —
 * trial-approved email goes out, trials row keeps its NULL clock, and the
 * beta-launch pass re-issues with a fresh clock. Which issuer runs is the
 * glue's one-line choice.
 */

export interface TrialActivationStore {
  /** Flip pending_launch → active and stamp the clock, atomically per domain. */
  activateTrial(
    domain: string,
    activation: { licenseId: string; startedAt: number; expiresAt: number },
  ): Promise<void>;
}

export interface TrialIssuanceDeps {
  issuer: Issuer;
  activation: TrialActivationStore;
  mailer: Pick<Mailer, 'send'>;
  now?: () => number;
}

export async function onTrialApproved(
  deps: TrialIssuanceDeps,
  trial: { domain: string; email: string },
): Promise<void> {
  const issuedAt = Math.floor((deps.now ?? Date.now)() / 1000);
  const claims: LicenseClaims = {
    domain: trial.domain,
    tier: 'trial',
    seats: null,
    issued_at: issuedAt,
    expires_at: issuedAt + TRIAL_SECONDS,
    license_id: crypto.randomUUID(),
  };

  const result = await deps.issuer.issue(claims);
  if (!result.issued) {
    // Pending launch: approval only — no license_id, no clock.
    await deps.mailer.send('trial-approved', trial.email, { domain: trial.domain });
    return;
  }

  // Clock starts AT issuance — the ledgered public promise.
  await deps.activation.activateTrial(trial.domain, {
    licenseId: claims.license_id,
    startedAt: claims.issued_at,
    expiresAt: claims.expires_at,
  });
  await deps.mailer.send('trial-key-delivery', trial.email, {
    domain: trial.domain,
    licenseKey: result.licenseKey,
    expiresAt: formatUtcDate(claims.expires_at),
  });
}

function formatUtcDate(epochSeconds: number): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(epochSeconds * 1000),
  );
}

/** D1-backed activation store used by the live endpoint. */
export function d1TrialActivationStore(db: D1Database): TrialActivationStore {
  return {
    async activateTrial(domain, activation) {
      await db
        .prepare(
          `UPDATE trials SET status = 'active', license_id = ?, started_at = ?, expires_at = ?
           WHERE domain = ? AND status = 'pending_launch'`,
        )
        .bind(activation.licenseId, activation.startedAt, activation.expiresAt, domain)
        .run();
    },
  };
}
