-- S12.4: manual licence issuance. A review queue, and a record of every key that has left this service.
--
-- ⛔ ISSUANCE IS MANUAL BY FOUNDER RULING. Tunnex verifies licences OFFLINE, so there is NO REVOCATION: a
-- key that is minted is alive until its expiry and nothing afterwards reaches it. An automated mint is a
-- mistake that cannot be taken back, so a human signs. These two tables are the queue and the ledger.
--
-- ⭐ trials IS NOT TOUCHED. No fourth status, no CHECK-constraint change, no table rebuild on the table
-- holding every live trial. The review step rides the Issuer seam's EXISTING deferral: a queued trial stays
-- status='pending_launch', which already means exactly "approved, no key, clock not started".
--
-- Append-only rule: this file is never edited once applied. IF NOT EXISTS throughout, matching 0002 — the
-- 2026-07-12 hotfix showed a remote can create the table and fail before recording the migration.

-- licence_review_queue — claims awaiting a human signature.
--
-- ⚠ ONE ROW PER TRIAL, not per attempt: UNIQUE(trial_domain) makes a re-queue idempotent, so a retry
-- upstream cannot produce two rows a reviewer would have to tell apart.
--
-- ⚠ NO email COLUMN, deliberately. `LicenseClaims` does not carry one, and an email column filled with a
-- domain is a column that lies in a way no reader can detect. The reviewer joins `trials` on the domain,
-- which is UNIQUE there.
CREATE TABLE IF NOT EXISTS licence_review_queue (
  id INTEGER PRIMARY KEY,
  trial_domain TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL,
  -- The claims exactly as the seam computed them. Stored so the human approves WHAT WAS COMPUTED rather
  -- than re-deriving it at signing time: a value invented at the signing screen is a value nobody reviewed,
  -- and under offline verification nobody can take it back.
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  license_id TEXT NOT NULL,
  queued_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Set when a human signs or declines; the row is retained either way. A refusal we cannot explain later
  -- is worse than a row we kept.
  decided_at INTEGER,
  decision TEXT CHECK (decision IN ('issued', 'refused'))
);
CREATE INDEX IF NOT EXISTS licence_review_queue_pending_idx
  ON licence_review_queue (queued_at) WHERE decided_at IS NULL;

-- issued_keys — every key that has ever left this service.
--
-- ⛔ THE SIGNED ARTEFACT IS STORED (never the private key). Offline verification means we cannot ask a
-- deployment what it is running, so this table is the ONLY record of what we put into the world. Losing it
-- means being permanently unable to answer "what does this customer actually have".
--
-- ⚠ And it is the only thing that makes a SUSPECTED compromise investigable at all — not detectable
-- (detection is impossible by construction; deployments never call home), but at least a key someone shows
-- us can be checked against the set we actually minted.
CREATE TABLE IF NOT EXISTS issued_keys (
  id INTEGER PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  band TEXT NOT NULL,
  -- ⭐ D4: WHICH signing key minted this. A key SET is unusable without it — retiring a kid means nothing
  -- if we cannot say which keys were minted under it.
  kid TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  licence_key TEXT NOT NULL,
  -- NULL => minted but delivery not confirmed. The admin surface says so rather than implying delivery.
  emailed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS issued_keys_domain_idx ON issued_keys (domain);
CREATE INDEX IF NOT EXISTS issued_keys_kid_idx ON issued_keys (kid);
