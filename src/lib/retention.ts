/**
 * Retention (S12.6, founder-ruled).
 *
 * ⛔ THE MEASUREMENT THAT FORCED THIS: three of four `trial_requests` rows hold a verified work email for
 * somebody who never got a trial. A verification round-trip is a request that went NOWHERE, and the row
 * outlived it by every day since — with `/privacy` promising we keep things "only as long as it's useful".
 *
 * ⭐ THE RULING, IN THREE PARTS:
 *   1. a request row that produced NO key expires after 90 days
 *   2. a row that DID produce a key keeps its link to the ledger
 *   3. the LEDGER ITSELF IS PERMANENT — it is the record of what was issued and it cannot be
 *      reconstructed. Offline verification means we can never ask a deployment what it is running, so a
 *      key someone shows us can only be checked against the set we know we minted.
 *
 * ⚠ SO THIS FILE DELETES FROM EXACTLY ONE TABLE, and that narrowness is the design rather than a first
 * increment. `issued_keys` is out of scope by ruling; `trials` and `subscribers` hold rows whose purpose
 * has not ended (a live trial, a subscription somebody asked for) and are their own decisions.
 */

/** ⛔ 90 DAYS, RULED. Long enough that a slow procurement cycle is not deleted mid-conversation. */
export const REQUEST_RETENTION_DAYS = 90;

export interface RetentionStore {
  /**
   * Delete request rows older than `before` whose domain never produced a key.
   *
   * ⛔ THE LEDGER IS THE ARBITER OF "PRODUCED A KEY", not the request's own columns. A consumed token
   * means somebody clicked a link; it does not mean a key exists. Only `issued_keys` knows.
   */
  purgeExpiredRequests(before: number): Promise<number>;
}

export interface RetentionResult {
  deleted: number;
}

/** Run one retention pass. Returns what it deleted so the caller can log a number rather than a promise. */
export async function runRetention(
  store: RetentionStore,
  now: number = Date.now(),
): Promise<RetentionResult> {
  const before = Math.floor(now / 1000) - REQUEST_RETENTION_DAYS * 86_400;
  const deleted = await store.purgeExpiredRequests(before);
  // ⚠ Logged as a COUNT, never as addresses. A retention job that prints what it deleted has copied the
  // data it was asked to remove into a log that is shipped and kept.
  console.log(JSON.stringify({ event: 'retention.requests_purged', deleted, before }));
  return { deleted };
}

export function d1RetentionStore(db: D1Database): RetentionStore {
  return {
    async purgeExpiredRequests(before) {
      // ⛔ `NOT EXISTS` AGAINST THE LEDGER, BY DOMAIN. The link a request has to a key is its domain —
      // there is no request id on `issued_keys` — so a domain that ever received a key keeps its request
      // rows, and a domain that never did loses them once they are stale.
      //
      // ⚠ AND THE COMPARISON IS ON created_at, NOT expires_at. `expires_at` bounds the TOKEN (30 minutes);
      // using it would delete every unconsumed request within the hour and call it retention.
      const res = await db
        .prepare(
          `DELETE FROM trial_requests
            WHERE created_at < ?
              AND NOT EXISTS (SELECT 1 FROM issued_keys k WHERE k.domain = trial_requests.domain)`,
        )
        .bind(before)
        .run();
      return res.meta.changes ?? 0;
    },
  };
}
