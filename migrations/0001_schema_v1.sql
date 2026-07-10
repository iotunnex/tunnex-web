-- Migration number: 0001 	 2026-07-10
-- Schema v1: subscribers, trial_requests, trials, enterprise_leads, email_events.
-- Timestamps are unix epoch seconds (INTEGER); tokens are stored as sha256 hex
-- of the raw token only — the raw token never touches the database.

-- Newsletter double-opt-in (EPIC 2 / S2.3).
CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  confirm_token_hash TEXT,
  confirm_token_expires_at INTEGER,
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Magic-link trial requests (EPIC 3 / S3.2, S3.3). One row per requested link;
-- consumed_at IS NULL is the atomic-consume guard.
CREATE TABLE trial_requests (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_trial_requests_token_hash ON trial_requests (token_hash);

-- One trial per company domain — UNIQUE(domain) is the final race-proof arbiter
-- for concurrent verifications (S3.3).
CREATE TABLE trials (
  id INTEGER PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_launch', 'active', 'expired')),
  license_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  expires_at INTEGER
);

-- Enterprise contact-sales leads (S2.4).
CREATE TABLE enterprise_leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  seats INTEGER,
  message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Lifecycle email dedup ledger (S3.5): UNIQUE(trial_id, kind) makes cron
-- reruns idempotent — a rerun can never double-send.
CREATE TABLE email_events (
  id INTEGER PRIMARY KEY,
  trial_id INTEGER NOT NULL REFERENCES trials (id),
  kind TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (trial_id, kind)
);
