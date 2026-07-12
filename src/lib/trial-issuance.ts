import type { Mailer } from './email/mailer.ts';

/**
 * Issuance boundary (S3.3 stub — S3.4 wires the real thing).
 *
 * The public promise: the trial clock starts at KEY ISSUANCE, not approval.
 * This stub therefore only sends the approval email ("key arrives at beta,
 * your 14 days start then") and touches NOTHING on trials — no license_id, no
 * started_at, no expires_at. S3.4 replaces the internals with the real
 * key-issuance path (prelaunch: cron at beta launch; beta: immediate) and owns
 * every clock write.
 */

export interface TrialIssuanceDeps {
  mailer: Pick<Mailer, 'send'>;
  now?: () => number;
}

export async function onTrialApproved(
  deps: TrialIssuanceDeps,
  trial: { domain: string; email: string },
): Promise<void> {
  await deps.mailer.send('trial-approved', trial.email, { domain: trial.domain });
}
