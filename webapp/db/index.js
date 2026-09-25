const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { seed } = require('./seed');
const { nextAdminId } = require('../utils/adminId');

// Configurable so production can point this at a mounted persistent disk (e.g.
// Render's disk feature) instead of the app's own ephemeral checkout — without a
// persistent disk, every deploy/restart would wipe out the entire database.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'cultured-africa.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

// Lightweight migration: CREATE TABLE IF NOT EXISTS above won't add new columns to a
// users table that already existed on disk before session_version was introduced.
const usersColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!usersColumns.includes('session_version')) {
  db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1');
}

// Migration: relax feedback.rating and feedback.comment from NOT NULL to nullable
// (a review can now be a rating only, a comment only, or both). SQLite can't drop a
// NOT NULL constraint via ALTER TABLE, so recreate the table and copy the data over.
const feedbackRatingCol = db.prepare('PRAGMA table_info(feedback)').all().find(c => c.name === 'rating');
if (feedbackRatingCol && feedbackRatingCol.notnull) {
  db.exec(`
    CREATE TABLE feedback_new (
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
    INSERT INTO feedback_new (feedback_id, user_id, content_id, rating, comment, admin_reply, submitted_date)
      SELECT feedback_id, user_id, content_id, rating, comment, admin_reply, submitted_date FROM feedback;
    DROP TABLE feedback;
    ALTER TABLE feedback_new RENAME TO feedback;
    CREATE INDEX IF NOT EXISTS idx_feedback_content ON feedback(content_id);
  `);
}

// Migration: add moderation columns (status/removed_by/removed_at/removal_reason) to a
// feedback table that already existed on disk before Manage Feedback was introduced.
const feedbackColumns = db.prepare('PRAGMA table_info(feedback)').all().map(c => c.name);
if (!feedbackColumns.includes('status')) {
  db.exec(`
    ALTER TABLE feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'removed'));
    ALTER TABLE feedback ADD COLUMN removed_by TEXT;
    ALTER TABLE feedback ADD COLUMN removed_at TEXT;
    ALTER TABLE feedback ADD COLUMN removal_reason TEXT;
  `);
}
// Runs unconditionally (rather than only inside the migration branch above) so it
// also covers a fresh database, where schema.sql already created the column but
// couldn't safely index it before this file confirms it exists.
db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status)');

// One-time migration: admin identity used to just be `users.role = 'admin'`. Move
// every such row into the new `admins` table (first one as super_admin, so there's
// always at least one), preserving their existing password hash so nobody gets
// locked out. Guarded by `admins` being empty so this never runs more than once —
// on every later startup the table already has rows and this is skipped entirely.
// The old `users` rows are deliberately left in place rather than deleted: content
// already uploaded under them references users(user_id), and deleting would violate
// that foreign key; POST /admin/upload's ensureShadowUserForAdmin() below keeps that
// FK satisfiable for admins created after this migration, which have no users row.
const adminsIsEmpty = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n === 0;
if (adminsIsEmpty) {
  const legacyAdmins = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY user_id ASC").all();
  const insertAdmin = db.prepare(`
    INSERT INTO admins (admin_id, name, email, password_hash, role, status, invited_by, verified_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?)
  `);
  legacyAdmins.forEach((u, i) => {
    const adminId = nextAdminId(db);
    insertAdmin.run(
      adminId, u.full_name, u.email, u.password_hash,
      i === 0 ? 'super_admin' : 'admin',
      u.registration_date, u.registration_date
    );
  });
}

seed(db);

// content.uploaded_by is a NOT NULL FK into users(user_id). Admins created through
// the new invite system only exist in the `admins` table, so this lazily creates a
// bookkeeping-only users row the first time such an admin uploads something — never
// used for login (routes/auth.js's customer login rejects role = 'admin' outright).
function ensureShadowUserForAdmin(admin) {
  const existing = db.prepare('SELECT user_id FROM users WHERE lower(email) = lower(?)').get(admin.email);
  if (existing) return existing.user_id;

  return db.prepare(`
    INSERT INTO users (full_name, email, password_hash, is_verified, role, avatar)
    VALUES (?, ?, ?, 1, 'admin', '')
  `).run(admin.name, admin.email, bcrypt.hashSync(crypto.randomUUID(), 10)).lastInsertRowid;
}

function logActivity(type, entity) {
  db.prepare('INSERT INTO activity_log (type, entity) VALUES (?, ?)').run(type, entity);
}

function notify(userId, type, message) {
  db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)').run(userId, type, message);
}

function logAudit(adminId, action, targetType, targetId, details) {
  db.prepare(`
    INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(String(adminId), action, targetType, targetId === null || targetId === undefined ? null : String(targetId), details || null);
}

module.exports = { db, logActivity, notify, logAudit, ensureShadowUserForAdmin };
