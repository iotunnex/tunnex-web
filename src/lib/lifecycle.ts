import type { Mailer } from './email/mailer.ts';
import { onTrialApproved, type TrialIssuanceDeps } from './trial-issuance.ts';
import { TRIAL_DAYS } from './issuance.ts';

/**
 * Daily lifecycle cron (S3.5 — final EPIC 3 story).
 *
 * Beta-only trial legs, in order: promote pending_launch trials (the
 * beta-launch pass — re-issues with a FRESH clock via the issuance seam),
 * day-10 reminder, expiry flip + upgrade email, day-21 follow-up. Every send
 * is gated by an email_events claim (UNIQUE(trial_id, kind)) so reruns cannot
 * double-send — at-most-once by construction.
 *
 * Housekeeping runs in BOTH modes: prune consumed/expired trial_requests and
 * stale unconfirmed subscribers. In prelaunch the trial legs are a no-op.
 */

const DAY = 86_400;

/**
 * ⛔ DERIVED FROM TRIAL_DAYS, NOT HARDCODED — and this is the second half of the same defect.
 *
 * These were `10 * DAY` and `21 * DAY`: the reminder four days before a 14-day trial ended, the follow-up
 * a week after it expired. Both numbers ENCODED A 14-DAY TRIAL and neither moved when the constant did.
 *
 * ⚠ At 30 days the literals are not merely stale, they are WRONG IN OPPOSITE DIRECTIONS: the reminder
 * would fire on day 10 saying "20 days left", and THE FOLLOW-UP WOULD FIRE ON DAY 21 — nine days BEFORE
 * the trial expired — telling a customer with a live trial that theirs had ended.
 *
 * ⭐ So the INTENT is expressed, not the number: remind four days before expiry; follow up a week after.
 */
export const REMINDER_LEAD_DAYS = 4;
export const FOLLOWUP_AFTER_EXPIRY_DAYS = 7;
export const REMINDER_AFTER_SECONDS = (TRIAL_DAYS - REMINDER_LEAD_DAYS) * DAY;
export const FOLLOWUP_AFTER_SECONDS = (TRIAL_DAYS + FOLLOWUP_AFTER_EXPIRY_DAYS) * DAY;

export interface LifecycleTrial {
  id: number;
  domain: string;
  email: string;
}

export interface LifecycleStore {
  /** Trials awaiting the beta-launch pass. */
  pendingLaunchTrials(): Promise<LifecycleTrial[]>;
  /** Active trials at day >= 10 that have not yet expired. */
  reminderDueTrials(now: number): Promise<(LifecycleTrial & { expiresAt: number })[]>;
  /** Active trials whose clock has run out. */
  expiryDueTrials(now: number): Promise<LifecycleTrial[]>;
  /** Flip active → expired; harmless on rerun (guarded by status). */
  markExpired(trialId: number): Promise<void>;
  /** Expired trials at day >= 21 after start. */
  followupDueTrials(now: number): Promise<LifecycleTrial[]>;
  /**
   * Claim a send in email_events. True exactly once per (trial, kind) —
   * the UNIQUE constraint is the rerun arbiter.
   */
  claimEmailEvent(trialId: number, kind: string): Promise<boolean>;
  /** Delete consumed or expired trial_requests rows. Returns rows removed. */
  pruneTrialRequests(now: number): Promise<number>;
  /** Delete unconfirmed subscribers whose token expired. Returns rows removed. */
  pruneStaleSubscribers(now: number): Promise<number>;
}

export interface LifecycleDeps extends Omit<TrialIssuanceDeps, 'now'> {
  store: LifecycleStore;
  mailer: Pick<Mailer, 'send'>;
  mode: 'prelaunch' | 'beta';
  now?: () => number;
}

export interface LifecycleSummary {
  promoted: number;
  reminded: number;
  expired: number;
  followedUp: number;
  prunedRequests: number;
  prunedSubscribers: number;
}

export async function runLifecycle(deps: LifecycleDeps): Promise<LifecycleSummary> {
  const nowSec = Math.floor((deps.now ?? Date.now)() / 1000);
  const summary: LifecycleSummary = {
    promoted: 0,
    reminded: 0,
    expired: 0,
    followedUp: 0,
    prunedRequests: 0,
    prunedSubscribers: 0,
  };

  if (deps.mode === 'beta') {
    // Beta-launch pass: promote what verification parked. onTrialApproved
    // builds FRESH claims (clock starts now, at issuance — the promise).
    for (const trial of await deps.store.pendingLaunchTrials()) {
      // ⛔ THIS CLAIM IS SPENT ON PURPOSE, AND THE QUEUE IS NOW THE ONLY ROUTE FORWARD.
      //
      // Under manual issuance the injected issuer is `reviewQueueIssuer`: it records the claims for a
      // human and returns issued:false. So this attempt does NOT promote the trial — it enqueues it — and
      // the claim is burned all the same. The trial then waits for a person, and THIS CRON WILL NEVER
      // TOUCH IT AGAIN (the claim is UNIQUE(trial_id, kind), so the next run skips it).
      //
      // ⚠ THAT IS CORRECT, NOT A LEAK. A future reader seeing "a wasted claim" must not fix it by
      // retrying or by releasing the claim: a retry loop here puts the CRON BACK ON THE MINT PATH — an
      // unattended job at 03:17 issuing licences that, because verification is offline, can never be
      // revoked. The burn is what stops that.
      //
      // If a queued trial needs to move, it moves through the review queue. Not through here.
      if (!(await deps.store.claimEmailEvent(trial.id, 'trial-key-delivery'))) continue;
      try {
        await onTrialApproved(
          { issuer: deps.issuer, activation: deps.activation, mailer: deps.mailer, now: deps.now },
          trial,
        );
        summary.promoted += 1;
      } catch (error) {
        // Claim is burned but the trial is still pending_launch — loud log so
        // the stuck promotion is visible; manual re-claim is the recovery.
        logLeg('promotion_failed', trial.domain, error);
      }
    }

    for (const trial of await deps.store.reminderDueTrials(nowSec)) {
      if (!(await deps.store.claimEmailEvent(trial.id, 'trial-d10-reminder'))) continue;
      const daysLeft = Math.ceil((trial.expiresAt - nowSec) / DAY);
      await deps.mailer.send('trial-d10-reminder', trial.email, {
        domain: trial.domain,
        daysLeft,
        expiresAt: formatUtcDate(trial.expiresAt),
      });
      summary.reminded += 1;
    }

    for (const trial of await deps.store.expiryDueTrials(nowSec)) {
      await deps.store.markExpired(trial.id);
      if (!(await deps.store.claimEmailEvent(trial.id, 'trial-expired-upgrade'))) continue;
      await deps.mailer.send('trial-expired-upgrade', trial.email, { domain: trial.domain });
      summary.expired += 1;
    }

    for (const trial of await deps.store.followupDueTrials(nowSec)) {
      if (!(await deps.store.claimEmailEvent(trial.id, 'trial-d21-followup'))) continue;
      await deps.mailer.send('trial-d21-followup', trial.email, { domain: trial.domain });
      summary.followedUp += 1;
    }
  }

  summary.prunedRequests = await deps.store.pruneTrialRequests(nowSec);
  summary.prunedSubscribers = await deps.store.pruneStaleSubscribers(nowSec);

  console.log(JSON.stringify({ event: 'lifecycle.run', mode: deps.mode, ...summary }));
  return summary;
}

function logLeg(leg: string, domain: string, error: unknown): void {
  console.log(
    JSON.stringify({
      event: `lifecycle.${leg}`,
      domain,
      error: error instanceof Error ? error.message : 'unknown',
    }),
  );
}

function formatUtcDate(epochSeconds: number): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(epochSeconds * 1000),
  );
}

/** D1-backed store used by the scheduled handler. */
export function d1LifecycleStore(db: D1Database): LifecycleStore {
  const trialRows = async (sql: string, ...binds: unknown[]) => {
    const { results } = await db
      .prepare(sql)
      .bind(...binds)
      .all<{ id: number; domain: string; email: string; expires_at?: number }>();
    return results;
  };
  return {
    async pendingLaunchTrials() {
      return trialRows("SELECT id, domain, email FROM trials WHERE status = 'pending_launch'");
    },
    async reminderDueTrials(now) {
      const rows = await trialRows(
        `SELECT id, domain, email, expires_at FROM trials
         WHERE status = 'active' AND started_at + ? <= ? AND expires_at > ?`,
        REMINDER_AFTER_SECONDS,
        now,
        now,
      );
      return rows.map((r) => ({ ...r, expiresAt: r.expires_at! }));
    },
    async expiryDueTrials(now) {
      return trialRows(
        "SELECT id, domain, email FROM trials WHERE status = 'active' AND expires_at <= ?",
        now,
      );
    },
    async markExpired(trialId) {
      await db
        .prepare("UPDATE trials SET status = 'expired' WHERE id = ? AND status = 'active'")
        .bind(trialId)
        .run();
    },
    async followupDueTrials(now) {
      return trialRows(
        `SELECT id, domain, email FROM trials
         WHERE status = 'expired' AND started_at + ? <= ?`,
        FOLLOWUP_AFTER_SECONDS,
        now,
      );
    },
    async claimEmailEvent(trialId, kind) {
      const result = await db
        .prepare('INSERT OR IGNORE INTO email_events (trial_id, kind) VALUES (?, ?)')
        .bind(trialId, kind)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },
    async pruneTrialRequests(now) {
      const result = await db
        .prepare('DELETE FROM trial_requests WHERE consumed_at IS NOT NULL OR expires_at <= ?')
        .bind(now)
        .run();
      return result.meta.changes ?? 0;
    },
    async pruneStaleSubscribers(now) {
      const result = await db
        .prepare(
          `DELETE FROM subscribers
           WHERE confirmed_at IS NULL AND confirm_token_expires_at IS NOT NULL
             AND confirm_token_expires_at <= ?`,
        )
        .bind(now)
        .run();
      return result.meta.changes ?? 0;
    },
  };
}
