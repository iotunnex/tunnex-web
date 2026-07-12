import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FOLLOWUP_AFTER_SECONDS,
  REMINDER_AFTER_SECONDS,
  runLifecycle,
  type LifecycleStore,
} from './lifecycle.ts';
import { TRIAL_SECONDS, pendingLaunchIssuer, placeholderKeyIssuer } from './issuance.ts';
import type { TrialActivationStore } from './trial-issuance.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const T0 = 1_800_000_000; // trial start epoch (seconds)
const DAY = 86_400;
const atDay = (d: number) => () => (T0 + d * DAY) * 1000;

interface TrialRow {
  id: number;
  domain: string;
  email: string;
  status: 'pending_launch' | 'active' | 'expired';
  startedAt: number | null;
  expiresAt: number | null;
  licenseId: string | null;
}

/** In-memory mirror of the D1 semantics, including UNIQUE(trial_id, kind). */
function fakeWorld(trials: Partial<TrialRow>[] = []) {
  let nextId = 1;
  const rows: TrialRow[] = trials.map((t) => ({
    id: nextId++,
    domain: 'acme.com',
    email: 'cto@acme.com',
    status: 'pending_launch',
    startedAt: null,
    expiresAt: null,
    licenseId: null,
    ...t,
  }));
  const emailEvents = new Set<string>();
  const trialRequests: { consumedAt: number | null; expiresAt: number }[] = [];
  const subscribers: { confirmedAt: number | null; tokenExpiresAt: number | null }[] = [];

  const store: LifecycleStore = {
    async pendingLaunchTrials() {
      return rows.filter((r) => r.status === 'pending_launch');
    },
    async reminderDueTrials(now) {
      return rows
        .filter(
          (r) =>
            r.status === 'active' &&
            r.startedAt! + REMINDER_AFTER_SECONDS <= now &&
            r.expiresAt! > now,
        )
        .map((r) => ({ ...r, expiresAt: r.expiresAt! }));
    },
    async expiryDueTrials(now) {
      return rows.filter((r) => r.status === 'active' && r.expiresAt! <= now);
    },
    async markExpired(trialId) {
      const row = rows.find((r) => r.id === trialId);
      if (row?.status === 'active') row.status = 'expired';
    },
    async followupDueTrials(now) {
      return rows.filter(
        (r) => r.status === 'expired' && r.startedAt! + FOLLOWUP_AFTER_SECONDS <= now,
      );
    },
    async claimEmailEvent(trialId, kind) {
      const key = `${trialId}:${kind}`;
      if (emailEvents.has(key)) return false;
      emailEvents.add(key);
      return true;
    },
    async pruneTrialRequests(now) {
      const before = trialRequests.length;
      for (let i = trialRequests.length - 1; i >= 0; i--) {
        const r = trialRequests[i]!;
        if (r.consumedAt !== null || r.expiresAt <= now) trialRequests.splice(i, 1);
      }
      return before - trialRequests.length;
    },
    async pruneStaleSubscribers(now) {
      const before = subscribers.length;
      for (let i = subscribers.length - 1; i >= 0; i--) {
        const s = subscribers[i]!;
        if (s.confirmedAt === null && s.tokenExpiresAt !== null && s.tokenExpiresAt <= now) {
          subscribers.splice(i, 1);
        }
      }
      return before - subscribers.length;
    },
  };

  const activation: TrialActivationStore = {
    async activateTrial(domain, a) {
      const row = rows.find((r) => r.domain === domain && r.status === 'pending_launch');
      if (!row) return;
      row.status = 'active';
      row.startedAt = a.startedAt;
      row.expiresAt = a.expiresAt;
      row.licenseId = a.licenseId;
    },
  };

  return { rows, emailEvents, trialRequests, subscribers, store, activation };
}

function mailerSpy() {
  const sent: { kind: string; to: string; data: Record<string, unknown> }[] = [];
  return {
    sent,
    async send(kind: string, to: string, data: never) {
      sent.push({ kind, to, data });
      return { id: 'msg_test' };
    },
  };
}

function betaDeps(world: ReturnType<typeof fakeWorld>, now: () => number) {
  const mailer = mailerSpy();
  return {
    mailer,
    deps: {
      store: world.store,
      activation: world.activation,
      issuer: placeholderKeyIssuer(),
      mailer,
      mode: 'beta' as const,
      now,
    },
  };
}

const ACTIVE = {
  status: 'active' as const,
  startedAt: T0,
  expiresAt: T0 + TRIAL_SECONDS,
  licenseId: 'lid',
};

describe('prelaunch: trial legs are a no-op, housekeeping still runs', () => {
  it('touches nothing trial-shaped even with everything due', async () => {
    const world = fakeWorld([
      { status: 'pending_launch' },
      { ...ACTIVE, domain: 'due-reminder.com' },
      { ...ACTIVE, domain: 'overdue.com', expiresAt: T0 + DAY },
    ]);
    world.trialRequests.push({ consumedAt: 123, expiresAt: T0 + 999_999 });
    world.subscribers.push({ confirmedAt: null, tokenExpiresAt: T0 - 1 });
    const mailer = mailerSpy();

    const summary = await runLifecycle({
      store: world.store,
      activation: world.activation,
      issuer: pendingLaunchIssuer(),
      mailer,
      mode: 'prelaunch',
      now: atDay(30),
    });

    expect(mailer.sent.length).toBe(0);
    expect(world.rows.map((r) => r.status).sort()).toEqual(['active', 'active', 'pending_launch']);
    expect(summary).toMatchObject({
      promoted: 0,
      reminded: 0,
      expired: 0,
      followedUp: 0,
      prunedRequests: 1,
      prunedSubscribers: 1,
    });
  });
});

describe('beta-launch pass (promotion)', () => {
  it('promotes pending_launch with a FRESH clock at promotion time, key-delivery once', async () => {
    const world = fakeWorld([{ status: 'pending_launch' }]);
    const promoteAt = atDay(45); // long after the verify click
    const { mailer, deps } = betaDeps(world, promoteAt);

    const summary = await runLifecycle(deps);
    expect(summary.promoted).toBe(1);
    const row = world.rows[0]!;
    expect(row.status).toBe('active');
    expect(row.startedAt).toBe(T0 + 45 * DAY); // clock starts at ISSUANCE, not verify
    expect(row.expiresAt).toBe(T0 + 45 * DAY + TRIAL_SECONDS);
    expect(mailer.sent.map((s) => s.kind)).toEqual(['trial-key-delivery']);

    // rerun: nothing pending, claim burned — zero new sends
    const rerun = await runLifecycle(deps);
    expect(rerun.promoted).toBe(0);
    expect(mailer.sent.length).toBe(1);
  });
});

describe('time-travel transitions (beta)', () => {
  it('day 9.9: nothing due', async () => {
    const world = fakeWorld([{ ...ACTIVE }]);
    const { mailer, deps } = betaDeps(world, atDay(9.9));
    await runLifecycle(deps);
    expect(mailer.sent.length).toBe(0);
  });

  it('day 10: d10 reminder once, daysLeft 4; rerun sends nothing', async () => {
    const world = fakeWorld([{ ...ACTIVE }]);
    const { mailer, deps } = betaDeps(world, atDay(10));
    await runLifecycle(deps);
    expect(mailer.sent).toEqual([
      {
        kind: 'trial-d10-reminder',
        to: 'cto@acme.com',
        data: { domain: 'acme.com', daysLeft: 4, expiresAt: expect.any(String) },
      },
    ]);
    await runLifecycle(deps); // same day rerun
    await runLifecycle({ ...deps, now: atDay(12) }); // later rerun, still in window
    expect(mailer.sent.length).toBe(1);
  });

  it('day 14: expiry flips status and sends the upgrade email once', async () => {
    const world = fakeWorld([{ ...ACTIVE }]);
    const { mailer, deps } = betaDeps(world, atDay(14));
    const summary = await runLifecycle(deps);
    expect(world.rows[0]!.status).toBe('expired');
    expect(summary.expired).toBe(1);
    expect(mailer.sent.some((s) => s.kind === 'trial-expired-upgrade')).toBe(true);

    const rerun = await runLifecycle({ ...deps, now: atDay(15) });
    expect(rerun.expired).toBe(0);
    expect(mailer.sent.filter((s) => s.kind === 'trial-expired-upgrade').length).toBe(1);
  });

  it('day 21: follow-up once on the expired trial; rerun idempotent', async () => {
    const world = fakeWorld([{ ...ACTIVE, status: 'expired' }]);
    const { mailer, deps } = betaDeps(world, atDay(21));
    await runLifecycle(deps);
    await runLifecycle({ ...deps, now: atDay(22) });
    expect(mailer.sent.filter((s) => s.kind === 'trial-d21-followup').length).toBe(1);
  });

  it('full timeline: cron every day for 25 days sends exactly 3 emails in order', async () => {
    const world = fakeWorld([{ ...ACTIVE }]);
    const mailer = mailerSpy();
    for (let day = 0; day <= 25; day++) {
      await runLifecycle({
        store: world.store,
        activation: world.activation,
        issuer: placeholderKeyIssuer(),
        mailer,
        mode: 'beta',
        now: atDay(day),
      });
    }
    expect(mailer.sent.map((s) => s.kind)).toEqual([
      'trial-d10-reminder',
      'trial-expired-upgrade',
      'trial-d21-followup',
    ]);
    expect(world.rows[0]!.status).toBe('expired');
  });

  it('double-send is impossible: the email_events claim is the arbiter', async () => {
    const world = fakeWorld([{ ...ACTIVE }]);
    // Simulate two overlapping runs at the same instant.
    const a = betaDeps(world, atDay(10));
    const b = { ...a.deps, mailer: a.mailer };
    await Promise.all([runLifecycle(a.deps), runLifecycle(b)]);
    expect(a.mailer.sent.filter((s) => s.kind === 'trial-d10-reminder').length).toBe(1);
  });
});

describe('housekeeping prune', () => {
  it('removes consumed and expired trial_requests, keeps live ones', async () => {
    const world = fakeWorld();
    const nowSec = T0 + 30 * DAY;
    world.trialRequests.push(
      { consumedAt: T0, expiresAt: T0 + 1800 }, // consumed → prune
      { consumedAt: null, expiresAt: nowSec - 60 }, // expired → prune
      { consumedAt: null, expiresAt: nowSec + 1700 }, // live → keep
    );
    const { deps } = betaDeps(world, atDay(30));
    const summary = await runLifecycle(deps);
    expect(summary.prunedRequests).toBe(2);
    expect(world.trialRequests.length).toBe(1);
  });

  it('removes stale unconfirmed subscribers, keeps confirmed and pending-live', async () => {
    const world = fakeWorld();
    const nowSec = T0 + 30 * DAY;
    world.subscribers.push(
      { confirmedAt: null, tokenExpiresAt: nowSec - 60 }, // stale → prune
      { confirmedAt: T0, tokenExpiresAt: null }, // confirmed → keep
      { confirmedAt: null, tokenExpiresAt: nowSec + 3600 }, // pending live → keep
    );
    const { deps } = betaDeps(world, atDay(30));
    const summary = await runLifecycle(deps);
    expect(summary.prunedSubscribers).toBe(1);
    expect(world.subscribers.length).toBe(2);
  });
});
