-- S12.7: a paid request path, and the ledger read that did not exist.
--
-- ⛔ THE REBUILD IS NOT COSMETIC. `licence_review_queue.trial_domain` carries a column-level UNIQUE, and
-- the only producer inserts `ON CONFLICT (trial_domain) DO NOTHING` while DECIDED ROWS ARE RETAINED
-- FOREVER. So a company that took a trial and later wants to BUY hits a row that already exists and their
-- request is DISCARDED WITH A SUCCESS RESPONSE — no row, no log line, no email says otherwise.
--
-- > ## ⛔ **THAT IS NOT A REFUSAL THAT NEEDS SOFTENING. IT IS A NO-OP WITH NO OBSERVER.**
--
-- SQLite cannot drop a column-level UNIQUE, so the table is rebuilt. Uniqueness moves to a PARTIAL index
-- over PENDING rows only: one OPEN request per domain at a time, any number of settled ones across a
-- customer's life. That is the rule the product actually wants — "do not queue the same thing twice",
-- never "you already had your turn".
--
-- ⭐ `(domain) WHERE decided_at IS NULL`, NOT `(domain, kind)`. A domain with a trial already pending
-- cannot ALSO have a paid request open, and that is deliberate: two open rows for one domain are two
-- rows a reviewer can sign, and two signatures are two live unrevocable keys for one customer. The paid
-- form REFUSES VISIBLY in that case ("a request for this domain is already with us") — which is the whole
-- correction, since the bug being fixed is a silent one.
--
-- ⚠ `trial_domain` IS RENAMED TO `domain`. After this story the column holds paid and direct rows too, and
-- a column whose name contradicts its contents is a defect with a track record in this codebase. The
-- rename is free inside a rebuild that is already happening and costs a second rebuild later.
--
-- Append-only rule: this file is never edited once applied.

-- 1. The new shape.
CREATE TABLE IF NOT EXISTS licence_review_queue_v2 (
  id INTEGER PRIMARY KEY,
  domain TEXT NOT NULL,
  -- ⛔ WHAT KIND OF REQUEST THIS IS, and it governs what the reviewer may do with it:
  --   'trial'  — the free path. Signable immediately; activates a `trials` row.
  --   'paid'   — a purchase request. ⛔ NOT SIGNABLE until payment is settled offline.
  --   'direct' — the founder closed a deal and minted without a request existing.
  kind TEXT NOT NULL DEFAULT 'trial' CHECK (kind IN ('trial', 'paid', 'direct')),
  -- The band that will be MINTED. For a trial this is what the seam computed; for a paid row it is what
  -- the REVIEWER set, never what the requester asked for.
  tier TEXT NOT NULL,
  -- ⛔ WHAT THEY ASKED FOR, KEPT SEPARATE AND NEVER SIGNED. Nobody gets Scale by asking for it. Recorded
  -- so a reviewer can see the gap between the request and their own decision — which is the only place
  -- that gap is visible at all.
  requested_band TEXT,
  -- ⛔ PAYMENT IS SETTLED OFFLINE, AND THIS IS THE GATE. 'n/a' for trials (nothing to settle); a paid row
  -- starts 'pending' and only a deliberate act moves it to 'settled'.
  --
  -- ⚠ A TRIAL MISTAKE EXPIRES IN 30 DAYS. A PAID KEY IS A YEAR AND CANNOT BE RECALLED — signing before
  -- the money arrives is the first mistake this screen makes available.
  payment_state TEXT NOT NULL DEFAULT 'n/a' CHECK (payment_state IN ('n/a', 'pending', 'settled')),
  payment_settled_at INTEGER,
  -- The claims exactly as computed, so the human approves WHAT WAS COMPUTED rather than re-deriving it at
  -- signing time (carried forward from 0003 — the reasoning is unchanged).
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  license_id TEXT NOT NULL,
  -- Delivery address. ⚠ 0003 deliberately had none and joined `trials` instead, because `LicenseClaims`
  -- carries no email. A paid or direct row has NO `trials` row to join, so without this the reviewer can
  -- mint a key and have nowhere to send it — `no_trial_email` was already a first-class failure.
  contact_email TEXT,
  -- What the founder needs in order to price it. Free text and a number; never parsed, only read.
  requested_term_months INTEGER,
  gateways INTEGER,
  company TEXT,
  notes TEXT,
  queued_at INTEGER NOT NULL DEFAULT (unixepoch()),
  decided_at INTEGER,
  decision TEXT CHECK (decision IN ('issued', 'refused'))
);

-- 2. Carry every existing row across, decided ones included. A refusal we cannot explain later is worse
--    than a row we kept (0003), and that applies to the rebuild itself.
INSERT INTO licence_review_queue_v2
  (id, domain, kind, tier, payment_state, issued_at, expires_at, license_id, queued_at, decided_at, decision)
SELECT id, trial_domain, 'trial', tier, 'n/a', issued_at, expires_at, license_id, queued_at, decided_at, decision
  FROM licence_review_queue;

DROP TABLE licence_review_queue;
ALTER TABLE licence_review_queue_v2 RENAME TO licence_review_queue;

-- 3. ⛔ THE INDEX AND THE CONFLICT TARGET MUST MATCH EXACTLY. The silent discard exists because an
--    `ON CONFLICT (trial_domain)` clause pointed at a constraint whose meaning nobody re-read. The
--    producer's conflict target is this index, and a mismatch is a runtime error rather than a no-op —
--    which is the failure mode worth having.
CREATE UNIQUE INDEX IF NOT EXISTS licence_review_queue_open_idx
  ON licence_review_queue (domain) WHERE decided_at IS NULL;
CREATE INDEX IF NOT EXISTS licence_review_queue_pending_idx
  ON licence_review_queue (queued_at) WHERE decided_at IS NULL;
CREATE INDEX IF NOT EXISTS licence_review_queue_domain_idx ON licence_review_queue (domain);

-- 4. The pre-verification stage. `trial_requests` could only express "a trial": no band, no term, nothing
--    a paid request has to carry across the email round-trip. ⚠ ADD COLUMN only — this table holds live
--    unconsumed tokens and must not be rebuilt underneath them.
ALTER TABLE trial_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE trial_requests ADD COLUMN requested_band TEXT;
ALTER TABLE trial_requests ADD COLUMN requested_term_months INTEGER;
ALTER TABLE trial_requests ADD COLUMN gateways INTEGER;
ALTER TABLE trial_requests ADD COLUMN company TEXT;
ALTER TABLE trial_requests ADD COLUMN notes TEXT;
