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

-- One row per (user, film) session-visit — the session log used for analytics
-- (views, peak times, per-session completion rate). A new row is created every time
-- a film's page is opened, so a single film can have many rows for the same user.
CREATE TABLE IF NOT EXISTS watch_history (
  history_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content_id        INTEGER NOT NULL REFERENCES content(content_id) ON DELETE CASCADE,
  progress_seconds  INTEGER NOT NULL DEFAULT 0,
  completed         INTEGER NOT NULL DEFAULT 0,
  watch_date        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Exactly one row per (user, film): the furthest playback position ever reached,
-- used to resume "continue watching" and to report accurate, non-inflated total
-- watch time (summing watch_history directly would double-count repeat sessions
-- that rewatch the same stretch of a film).
CREATE TABLE IF NOT EXISTS watch_progress (
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content_id        INTEGER NOT NULL REFERENCES content(content_id) ON DELETE CASCADE,
  position_seconds  INTEGER NOT NULL DEFAULT 0,
  completed         INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, content_id)
);

-- rating and comment are both optional (but not both empty — enforced in the route):
-- a viewer can leave a star rating only, a text comment only, or both together.
-- Removal is a soft delete (status flips to 'removed', row is kept) so moderation
-- actions stay reversible and auditable via admin_audit_log below.
CREATE TABLE IF NOT EXISTS feedback (
  feedback_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content_id        INTEGER NOT NULL REFERENCES content(content_id) ON DELETE CASCADE,
  rating            INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  comment           TEXT,
  admin_reply       TEXT,
  status            TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'removed')),
  removed_by        TEXT,
  removed_at        TEXT,
  removal_reason    TEXT,
  submitted_date    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Not part of the ERD; an append-only trail of moderation and admin-management
-- actions (feedback removals/restores, invites, deactivations, role changes).
-- admin_id and target_id are stored as TEXT so this table can log against any
-- target_type without a set of nullable FK columns, one per entity kind.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin identity lives entirely here, separate from the customer `users` table —
-- an admin_id like ADM-0001 is reserved the moment an invite is sent (password_hash
-- starts NULL) so it's stable even before the invitee has verified anything.
CREATE TABLE IF NOT EXISTS admins (
  admin_id      TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  invited_by    TEXT REFERENCES admins(admin_id),
  verified_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per invite sent. code_hash is a SHA-256 hash of the 6-digit code — the
-- plain code only ever exists in the email sent to the invitee. attempts counts
-- wrong-code guesses; 5 wrong guesses expires the invite outright (the admin row
-- from the table above stays reserved either way, so a super admin can just
-- resend a fresh invite for the same email/admin_id rather than starting over).
CREATE TABLE IF NOT EXISTS admin_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  invited_by  TEXT NOT NULL REFERENCES admins(admin_id),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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

-- Changing your account email is verification-gated, same as registration: the new
-- address isn't applied to users.email until its code is entered correctly, so a
-- typo'd or not-actually-yours address can't silently lock the account out. Only
-- one row per user is ever live — a new request supersedes any prior one (see
-- routes/account.js, which deletes old rows before inserting a fresh one).
CREATE TABLE IF NOT EXISTS email_change_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  new_email   TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_content_culture ON content(culture_id);
CREATE INDEX IF NOT EXISTS idx_purchases_content ON purchases(content_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_content ON feedback(content_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_invites_email ON admin_invites(email);
CREATE INDEX IF NOT EXISTS idx_watch_history_content ON watch_history(content_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_watch_date ON watch_history(watch_date);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_ecr_user ON email_change_requests(user_id);
