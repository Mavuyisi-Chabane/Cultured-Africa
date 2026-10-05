// Unit tests: dates are read as UTC and shown in South African time; backups work.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseDbDate, toSqlDateTime, formatDate, formatDateTime, startOfWeek, endOfWeek } = require('../utils/dates');

test('database times are read as UTC, whatever the server timezone', () => {
  const d = parseDbDate('2026-10-05 15:38:59');
  assert.equal(d.toISOString(), '2026-10-05T15:38:59.000Z');
  assert.equal(parseDbDate(null), null);
  assert.equal(parseDbDate(''), null);
  assert.equal(parseDbDate(d), d);
  assert.equal(toSqlDateTime(d), '2026-10-05 15:38:59');
});

test('dates and times are shown in South African time (UTC+2)', () => {
  const d = parseDbDate('2026-10-05 22:30:00');      // 00:30 on 6 Oct in Johannesburg
  assert.equal(formatDate(d), '6 Oct 2026');
  assert.match(formatDateTime(d), /6 Oct 2026.*00:30/);
  assert.equal(formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' }), '6 October 2026');
  assert.equal(formatDate(null), '');
});

test('weeks start on Monday at midnight South African time', () => {
  // Sunday 23:30 SAST is still the previous week; Monday 00:30 SAST is the new one.
  const sundayNight = new Date('2026-10-11T21:30:00Z');
  const mondayEarly = new Date('2026-10-11T22:30:00Z');
  assert.equal(startOfWeek(sundayNight).toISOString(), '2026-10-04T22:00:00.000Z');
  assert.equal(startOfWeek(mondayEarly).toISOString(), '2026-10-11T22:00:00.000Z');
  assert.equal(endOfWeek(mondayEarly).getTime() - startOfWeek(mondayEarly).getTime(), 7 * 24 * 60 * 60 * 1000);
});

test('backups: a complete copy is made and only the newest are kept', async () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cultured-africa-backup-test-'));
  try {
    const env = { ...process.env, NODE_ENV: 'test', SEED_DEMO_DATA: 'true', DB_PATH: path.join(dir, 'app.sqlite'), BACKUP_DIR: path.join(dir, 'backups'), BACKUP_KEEP: '2' };
    // Three backups a second apart (file names are per second); only two may remain.
    for (let i = 0; i < 3; i++) {
      const r = spawnSync(process.execPath, ['scripts/backup-db.js'], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      if (i < 2) await new Promise(res => setTimeout(res, 1100));
    }
    const files = fs.readdirSync(env.BACKUP_DIR);
    assert.equal(files.length, 2);

    const { DatabaseSync } = require('node:sqlite');
    const copy = new DatabaseSync(path.join(env.BACKUP_DIR, files[1]));
    assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM content').get().n > 0, 'backup contains the data');
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    copy.close();

    const live = new DatabaseSync(env.DB_PATH);
    assert.equal(live.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    live.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('restoring: a "<database>.restore" file replaces the database on the next start', () => {
  const { spawnSync } = require('node:child_process');
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cultured-africa-restore-test-'));
  try {
    const env = { ...process.env, NODE_ENV: 'test', SEED_DEMO_DATA: 'false', DB_PATH: path.join(dir, 'app.sqlite'), BACKUP_DIR: path.join(dir, 'backups') };
    const run = args => spawnSync(process.execPath, args, { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
    // A database with one culture, backed up; then a second culture added after the backup.
    assert.equal(run(['-e', "require('./db').db.prepare(\"INSERT INTO cultures (name) VALUES ('Before backup')\").run()"]).status, 0);
    assert.equal(run(['scripts/backup-db.js']).status, 0);
    assert.equal(run(['-e', "require('./db').db.prepare(\"INSERT INTO cultures (name) VALUES ('After backup')\").run()"]).status, 0);

    const backup = fs.readdirSync(env.BACKUP_DIR)[0];
    fs.copyFileSync(path.join(env.BACKUP_DIR, backup), env.DB_PATH + '.restore');
    const started = run(['-e', "require('./db')"]);
    assert.match(started.stdout, /Database restored from backup/);

    const names = db => db.prepare('SELECT name FROM cultures ORDER BY name').all().map(r => r.name);
    const live = new DatabaseSync(env.DB_PATH);
    assert.deepEqual(names(live), ['Before backup'], 'the backup is now the database');
    live.close();
    assert.ok(!fs.existsSync(env.DB_PATH + '.restore'), 'restore file used up');
    const kept = fs.readdirSync(dir).find(f => f.startsWith('app.sqlite.before-restore-') && f.endsWith('Z'));
    const old = new DatabaseSync(path.join(dir, kept));
    assert.deepEqual(names(old), ['After backup', 'Before backup'], 'the previous database is kept, complete');
    old.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
