const express = require('express');
const { logActivity, adminActor, logAudit } = require('../db');
const { requireSuperAdmin } = require('../middleware/auth');
const { backupDatabase, listBackups, BACKUP_KEEP } = require('../utils/backup');
const { formatDateTime } = require('../utils/dates');

// Super admins only: take a database backup and download copies to keep off the server.
// A backup holds every customer's personal information, so downloads are logged and the
// page reminds admins to store copies securely (POPIA).
const router = express.Router();
router.use('/backups', requireSuperAdmin);

const MESSAGES = { created: 'Backup taken.', failed: 'The backup could not be taken. Check the server logs.' };

router.get('/backups', (req, res) => {
  const backups = listBackups().reverse().map(b => ({
    name: b.name,
    sizeLabel: b.size >= 1024 * 1024 ? `${(b.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b.size / 1024))} KB`,
    createdLabel: formatDateTime(b.createdAt)
  }));
  res.render('admin-backups', { backups, keep: BACKUP_KEEP, message: MESSAGES[req.query.msg] || null, failed: req.query.msg === 'failed' });
});

router.post('/backups', (req, res) => {
  try {
    const file = backupDatabase();
    logAudit(req.session.admin.id, 'created_backup', 'backup', null, require('path').basename(file));
    logActivity('Database backup taken', 'Database', adminActor(req.session.admin));
    res.redirect('/admin/backups?msg=created');
  } catch (err) {
    console.error('Manual backup failed:', err.message);
    res.redirect('/admin/backups?msg=failed');
  }
});

// Only names from the backup folder's own listing can be downloaded, never a path.
router.get('/backups/:name', (req, res) => {
  const backup = listBackups().find(b => b.name === req.params.name);
  if (!backup) return res.status(404).render('error', { status: 404, title: 'Backup not found', message: 'That backup no longer exists.' });
  logAudit(req.session.admin.id, 'downloaded_backup', 'backup', null, backup.name);
  logActivity('Database backup downloaded', backup.name, adminActor(req.session.admin));
  res.set('Cache-Control', 'private, no-store');
  res.download(backup.file, backup.name);
});

module.exports = router;
