PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name         TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  is_verified       INTEGER NOT NULL DEFAULT 0,
  role              TEXT NOT NULL CHECK (role IN ('customer', 'admin')),
  avatar            TEXT,
  session_version   INTEGER NOT NULL DEFAULT 1,
  registration_date TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cultures (
  culture_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE,
  description       TEXT,
  region            TEXT,
  banner_image_url  TEXT
);

CREATE TABLE IF NOT EXISTS content (
  content_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  culture_id        INTEGER NOT NULL REFERENCES cultures(culture_id),
  uploaded_by       INTEGER NOT NULL REFERENCES users(user_id),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  content_type      TEXT NOT NULL DEFAULT 'Film',
  price             REAL NOT NULL DEFAULT 0,
  file_url          TEXT NOT NULL,
  thumbnail_url     TEXT NOT NULL,
  trailer_url       TEXT,
  duration_seconds  INTEGER NOT NULL DEFAULT 0,
  upload_date       TEXT NOT NULL DEFAULT (datetime('now')),
  is_available      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS purchases (
  purchase_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content_id        INTEGER NOT NULL REFERENCES content(content_id) ON DELETE CASCADE,
  amount_paid       REAL NOT NULL,
  payment_status    TEXT NOT NULL DEFAULT 'completed' CHECK (payment_status IN ('pending', 'completed', 'failed')),
  transaction_ref   TEXT,
  purchase_date     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watch_history (
  history_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content_id        INTEGER NOT NULL REFERENCES content(content_id) ON DELETE CASCADE,
  progress_seconds  INTEGER NOT NULL DEFAULT 0,
  completed         INTEGER NOT NULL DEFAULT 0,
  watch_date        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  feedback_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content_id        INTEGER NOT NULL REFERENCES content(content_id) ON DELETE CASCADE,
  rating            INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment           TEXT NOT NULL,
  admin_reply       TEXT,
  submitted_date    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('purchase_confirmation', 'admin_reply', 'system')),
  message           TEXT NOT NULL,
  is_read           INTEGER NOT NULL DEFAULT 0,
  sent_date         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Not part of the ERD; an internal operational log powering the admin dashboard's
-- Recent Activity feed (the ERD models per-entity audit trails via Notification instead).
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  entity     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Never stores the raw code, only a SHA-256 hash of it, so a database leak alone
-- cannot be used to verify accounts. Each row is single-use (used flag) and time-boxed
-- (expires_at, checked server-side against SQLite's own UTC clock). token_hash is NOT
-- unique here: the value is a short 6-digit code (not a 256-bit token), so two
-- different users can legitimately be issued the same code — lookups are always
-- scoped by user_id, never by hash alone.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Same design as email_verification_tokens (hash-only storage, expiry, single-use),
-- kept as its own table since it's a semantically distinct token type with its own
-- lifetime (30 min vs 15) and its own "used_at" audit trail.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_content_culture ON content(culture_id);
CREATE INDEX IF NOT EXISTS idx_purchases_content ON purchases(content_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_content ON feedback(content_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_content ON watch_history(content_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_watch_date ON watch_history(watch_date);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
