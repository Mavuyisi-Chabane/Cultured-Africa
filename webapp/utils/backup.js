const fs = require('fs');
const path = require('path');
const { db, DB_PATH } = require('../db');

// Database backups: a complete, consistent copy of the database file, taken while the
// app keeps running (SQLite's VACUUM INTO). Kept in BACKUP_DIR, newest BACKUP_KEEP only.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
const FILE_PATTERN = /^cultured-africa-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.sqlite$/;

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(name => FILE_PATTERN.test(name))
    .sort()                                   // names sort by time
    .map(name => {
      const file = path.join(BACKUP_DIR, name);
      return { name, file, size: fs.statSync(file).size, createdAt: fs.statSync(file).mtime };
    });
}

function backupDatabase() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
  const file = path.join(BACKUP_DIR, `cultured-africa-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

  // Keep only the newest BACKUP_KEEP copies.
  const all = listBackups();
  all.slice(0, Math.max(0, all.length - BACKUP_KEEP)).forEach(b => fs.unlinkSync(b.file));
  return file;
}

// Daily automatic backups while the app runs. The first runs a minute after start-up
// if the newest copy is more than 20 hours old, so restarts don't pile up extra copies.
function scheduleDailyBackups() {
  const run = () => {
    try {
      const file = backupDatabase();
      console.log(`Database backup saved: ${path.basename(file)}`);
    } catch (err) {
      console.error('Database backup failed:', err.message);
    }
  };
  const newest = listBackups().pop();
  const ageMs = newest ? Date.now() - newest.createdAt.getTime() : Infinity;
  setTimeout(() => { if (ageMs > 20 * 60 * 60 * 1000) run(); }, 60 * 1000).unref();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

module.exports = { BACKUP_DIR, BACKUP_KEEP, backupDatabase, listBackups, scheduleDailyBackups };
