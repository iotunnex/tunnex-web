import { describe, expect, it } from 'vitest';
import { runRetention, REQUEST_RETENTION_DAYS, type RetentionStore } from './retention.ts';

/**
 * ⛔ THE MEASUREMENT THAT FORCED THE RULING: three of four `trial_requests` rows held a verified work
 * email for somebody who never got a trial — kept forever, while /privacy promised otherwise.
 */
describe('retention', () => {
  it('purges request rows older than the ruled window', async () => {
    let asked = -1;
    const store: RetentionStore = {
      async purgeExpiredRequests(before) {
        asked = before;
        return 3;
      },
    };
    const now = 1_800_000_000_000; // ms
    const r = await runRetention(store, now);
    expect(r.deleted).toBe(3);
    // ⚠ The cutoff is the ruled window behind NOW, in seconds — the column's unit. A millisecond cutoff
    // would be ~1970 and delete nothing, which is the shape that passes a smoke test forever.
    expect(asked).toBe(Math.floor(now / 1000) - REQUEST_RETENTION_DAYS * 86_400);
  });

  it('⛔ the window is 90 days, and it is a ruling rather than a preference', () => {
    expect(REQUEST_RETENTION_DAYS).toBe(90);
  });
});
