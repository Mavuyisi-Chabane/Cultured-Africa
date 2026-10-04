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
// Migration: age classification. Films uploaded before this start unrated (NULL) and
// show "Not yet rated" until an admin sets one on the edit form.
const contentColumns = db.prepare('PRAGMA table_info(content)').all().map(c => c.name);
if (!contentColumns.includes('age_rating')) {
  db.exec(`
    ALTER TABLE content ADD COLUMN age_rating TEXT;
    ALTER TABLE content ADD COLUMN content_advisories TEXT NOT NULL DEFAULT '';
  `);
}

// Migration: payment details shown on receipts (channel, card brand, last 4 digits).
const purchaseColumns = db.prepare('PRAGMA table_info(purchases)').all().map(c => c.name);
if (!purchaseColumns.includes('payment_channel')) {
  db.exec(`
    ALTER TABLE purchases ADD COLUMN payment_channel TEXT;
    ALTER TABLE purchases ADD COLUMN card_brand TEXT;
    ALTER TABLE purchases ADD COLUMN card_last4 TEXT;
  `);
}

// Migration: customer suspension (Manage Customers page).
if (!usersColumns.includes('status')) {
  db.exec(`
    ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));
    ALTER TABLE users ADD COLUMN suspended_at TEXT;
    ALTER TABLE users ADD COLUMN suspension_reason TEXT;
  `);
}

// Migration: POPIA consent tracking. Existing customers start with NULL (no consent on
// record), so they are asked to agree on their next visit rather than assumed to have.
if (!usersColumns.includes('privacy_consent_at')) {
  db.exec(`
    ALTER TABLE users ADD COLUMN privacy_consent_at TEXT;
    ALTER TABLE users ADD COLUMN privacy_policy_version TEXT;
  `);
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

// Migration: record who made each change. Adds the actor columns to an activity_log
// that existed before they were introduced, then backfills older rows wherever the
// actor can be recovered unambiguously from other tables; anything else stays NULL
// and shows as "Not recorded" rather than guessing.
const activityColumns = db.prepare('PRAGMA table_info(activity_log)').all().map(c => c.name);
if (!activityColumns.includes('actor_name')) {
  db.exec(`
    ALTER TABLE activity_log ADD COLUMN actor_name TEXT;
    ALTER TABLE activity_log ADD COLUMN actor_role TEXT;

    -- Account events: the entity already is the customer's own name.
    UPDATE activity_log SET actor_name = entity, actor_role = 'customer'
    WHERE type IN ('New user registered', 'Email verified', 'Password reset', 'Email address changed', 'Account deleted');

    -- Uploads: the uploader of the film with that title.
    UPDATE activity_log SET
      actor_name = (SELECT a.name FROM content c JOIN users u ON u.user_id = c.uploaded_by
                    JOIN admins a ON lower(a.email) = lower(u.email) WHERE c.title = activity_log.entity LIMIT 1),
      actor_role = (SELECT a.role FROM content c JOIN users u ON u.user_id = c.uploaded_by
                    JOIN admins a ON lower(a.email) = lower(u.email) WHERE c.title = activity_log.entity LIMIT 1)
    WHERE type = 'Film uploaded';

    -- Purchases and reviews: the customer whose purchase/review has that film and timestamp.
    UPDATE activity_log SET actor_role = 'customer', actor_name = (
      SELECT u.full_name FROM purchases p JOIN content c ON c.content_id = p.content_id JOIN users u ON u.user_id = p.user_id
      WHERE c.title = activity_log.entity AND p.purchase_date = activity_log.created_at LIMIT 1)
    WHERE type = 'Purchase made';
    UPDATE activity_log SET actor_role = 'customer', actor_name = (
      SELECT u.full_name FROM feedback f JOIN content c ON c.content_id = f.content_id JOIN users u ON u.user_id = f.user_id
      WHERE c.title = activity_log.entity AND f.submitted_date = activity_log.created_at LIMIT 1)
    WHERE type = 'Review submitted';

    -- Feedback moderation: the admin audit log entry written in the same second.
    UPDATE activity_log SET
      actor_name = (SELECT a.name FROM admin_audit_log l JOIN admins a ON a.admin_id = l.admin_id
                    WHERE l.created_at = activity_log.created_at
                      AND l.action IN ('removed_feedback', 'restored_feedback', 'bulk_removed_feedback') LIMIT 1),
      actor_role = (SELECT a.role FROM admin_audit_log l JOIN admins a ON a.admin_id = l.admin_id
                    WHERE l.created_at = activity_log.created_at
                      AND l.action IN ('removed_feedback', 'restored_feedback', 'bulk_removed_feedback') LIMIT 1)
    WHERE type IN ('Feedback removed', 'Feedback restored', 'Bulk feedback removal');

    UPDATE activity_log SET actor_role = NULL WHERE actor_name IS NULL;
  `);
}

// Demo data (sample films, viewers and the admin@culturedafrica.co.za / admin123 login)
// is for local development only. A production database starts empty: create the first
// admin with `npm run create-admin`. SEED_DEMO_DATA=true forces it on (e.g. a demo server).
const SHOULD_SEED = process.env.SEED_DEMO_DATA === 'true'
  || (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO_DATA !== 'false');
if (SHOULD_SEED) seed(db);

// One Paystack payment = one purchase. Without this, the same successful reference could
// be replayed against every other film at the same price.
const duplicateRefs = db.prepare(`
  SELECT COUNT(*) AS n FROM (
    SELECT transaction_ref FROM purchases WHERE transaction_ref IS NOT NULL
    GROUP BY transaction_ref HAVING COUNT(*) > 1
  )
`).get().n;
if (duplicateRefs === 0) {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_transaction_ref ON purchases(transaction_ref) WHERE transaction_ref IS NOT NULL');
} else {
  console.warn(`${duplicateRefs} payment reference(s) are used by more than one purchase — the one-payment-per-purchase index was not created. Review the purchases table.`);
}

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

// `actor` is who made the change: { name, role } with role 'super_admin' | 'admin' |
// 'customer'. Build it with adminActor(req.session.admin) or customerActor(name).
function logActivity(type, entity, actor) {
  db.prepare('INSERT INTO activity_log (type, entity, actor_name, actor_role) VALUES (?, ?, ?, ?)')
    .run(type, entity, actor ? actor.name : null, actor ? actor.role : null);
}

function adminActor(admin) {
  return { name: admin.name, role: admin.role };
}

function customerActor(name) {
  return { name, role: 'customer' };
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

module.exports = { db, logActivity, adminActor, customerActor, notify, logAudit, ensureShadowUserForAdmin };
