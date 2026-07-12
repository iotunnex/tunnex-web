-- S3.5: lifecycle email ledger. UNIQUE(trial_id, kind) is the idempotence
-- arbiter — a cron rerun that tries to claim the same send changes 0 rows and
-- skips the email. Append-only rule: this file is never edited once applied.
CREATE TABLE email_events (
  id INTEGER PRIMARY KEY,
  trial_id INTEGER NOT NULL REFERENCES trials (id),
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (trial_id, kind)
);
