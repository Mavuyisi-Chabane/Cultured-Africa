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

seed(db);

function logActivity(type, entity) {
  db.prepare('INSERT INTO activity_log (type, entity) VALUES (?, ?)').run(type, entity);
}

function notify(userId, type, message) {
  db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)').run(userId, type, message);
}

module.exports = { db, logActivity, notify };
