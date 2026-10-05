// Takes a database backup now: npm run backup
// (The app also takes one automatically every day in production; see utils/backup.js.)
require('dotenv').config({ quiet: true });
const path = require('path');
const { backupDatabase, listBackups, BACKUP_DIR, BACKUP_KEEP } = require('../utils/backup');

const file = backupDatabase();
console.log(`Backup saved: ${file}`);
console.log(`${listBackups().length} backup(s) in ${BACKUP_DIR} (keeping the newest ${BACKUP_KEEP}).`);
console.log(`To restore: stop the app, copy ${path.basename(file)} over the database file (DB_PATH),`);
console.log('delete any -wal and -shm files next to it, then start the app again.');
