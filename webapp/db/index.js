const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { seed } = require('./seed');

const DB_PATH = path.join(__dirname, 'cultured-africa.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

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
      submitted_date    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO feedback_new (feedback_id, user_id, content_id, rating, comment, admin_reply, submitted_date)
      SELECT feedback_id, user_id, content_id, rating, comment, admin_reply, submitted_date FROM feedback;
    DROP TABLE feedback;
    ALTER TABLE feedback_new RENAME TO feedback;
    CREATE INDEX IF NOT EXISTS idx_feedback_content ON feedback(content_id);
  `);
}

seed(db);

function logActivity(type, entity) {
  db.prepare('INSERT INTO activity_log (type, entity) VALUES (?, ?)').run(type, entity);
}

function notify(userId, type, message) {
  db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)').run(userId, type, message);
}

module.exports = { db, logActivity, notify };
