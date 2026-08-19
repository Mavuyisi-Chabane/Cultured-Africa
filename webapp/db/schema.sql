PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  avatar        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS films (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  culture        TEXT NOT NULL,
  genre          TEXT NOT NULL,
  price          REAL NOT NULL DEFAULT 0,
  rating         REAL NOT NULL DEFAULT 0,
  video_url      TEXT NOT NULL,
  thumbnail_url  TEXT NOT NULL,
  trailer_url    TEXT,
  description    TEXT NOT NULL,
  uploaded_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  film_id             INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  price               REAL NOT NULL,
  paystack_reference  TEXT,
  purchased_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id     INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT NOT NULL,
  admin_reply TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS film_views (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id         INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completion_pct  REAL NOT NULL DEFAULT 0,
  viewed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  entity     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_purchases_film ON purchases(film_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_film ON reviews(film_id);
CREATE INDEX IF NOT EXISTS idx_film_views_film ON film_views(film_id);
CREATE INDEX IF NOT EXISTS idx_film_views_viewed_at ON film_views(viewed_at);
