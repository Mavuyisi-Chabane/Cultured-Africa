const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { seed } = require('./seed');

const DB_PATH = path.join(__dirname, 'cultured-africa.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
seed(db);

function logActivity(type, entity) {
  db.prepare('INSERT INTO activity_log (type, entity) VALUES (?, ?)').run(type, entity);
}

module.exports = { db, logActivity };
