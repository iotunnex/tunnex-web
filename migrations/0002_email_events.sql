-- S3.5: lifecycle email ledger. UNIQUE(trial_id, kind) is the idempotence
-- arbiter — a cron rerun that tries to claim the same send changes 0 rows and
-- skips the email. Append-only rule: this file is never edited once applied.
-- IF NOT EXISTS (2026-07-12 hotfix): the first remote apply created the table
-- but wrangler failed before recording the migration as applied, so every
-- redeploy re-ran the CREATE and failed. Idempotent form lets the stuck
-- remote converge; identical semantics on fresh databases.
CREATE TABLE IF NOT EXISTS email_events (
  id INTEGER PRIMARY KEY,
  trial_id INTEGER NOT NULL REFERENCES trials (id),
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (trial_id, kind)
);
