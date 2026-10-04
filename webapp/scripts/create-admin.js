// Creates a super admin from the command line — how the first admin is made on a
// production database, which (unlike development) is never seeded with demo logins.
//
//   npm run create-admin
//
// Prompts for name, email and password (the password is not echoed). Run it on the
// server, with the same DB_PATH / environment the app uses.
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { db, logAudit } = require('../db');
const { nextAdminId } = require('../utils/adminId');
const { getPasswordRequirementFailures } = require('../utils/password');

// One reader for every prompt — a new readline interface per question would lose
// answers that were already buffered (e.g. when input is piped in).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let masking = false;
const writeOutput = rl._writeToOutput.bind(rl);
rl._writeToOutput = text => {
  if (!masking) return writeOutput(text);
  // While a password is being typed, echo '*' instead of the characters — including
  // when readline redraws the whole line (prompt + typed text), e.g. after a backspace.
  const prompt = rl.getPrompt();
  const typed = text.startsWith(prompt) ? text.slice(prompt.length) : text;
  writeOutput((text.startsWith(prompt) ? prompt : '') + typed.replace(/[^\r\n]/g, '*'));
};

// Lines are queued as they arrive, so answers typed ahead (or piped in all at once)
// are matched to the questions in order instead of being dropped.
const lines = [];
const waiting = [];
rl.on('line', line => (waiting.length ? waiting.shift()(line) : lines.push(line)));
rl.on('close', () => waiting.splice(0).forEach(resolve => resolve('')));

function nextLine(question) {
  rl.setPrompt(question);
  rl.prompt();
  return lines.length ? Promise.resolve(lines.shift()) : new Promise(resolve => waiting.push(resolve));
}

async function ask(question) {
  return (await nextLine(question)).trim();
}

async function askHidden(question) {
  masking = true;
  const answer = await nextLine(question);
  masking = false;
  if (!process.stdin.isTTY) process.stdout.write('\n');
  return answer;
}

async function main() {
  console.log('Create a Cultured Africa super admin\n');
  const name = await ask('Full name: ');
  const email = (await ask('Email: ')).toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A name and a valid email address are required.');
  }
  if (db.prepare('SELECT 1 FROM admins WHERE lower(email) = ?').get(email)) {
    throw new Error(`An admin with the email ${email} already exists.`);
  }

  const password = await askHidden('Password: ');
  const failures = getPasswordRequirementFailures(password);
  if (failures.length) throw new Error(`Password must include ${failures.join(', ')}.`);
  if (password !== await askHidden('Confirm password: ')) throw new Error('Passwords do not match.');

  const adminId = nextAdminId(db);
  db.prepare(`
    INSERT INTO admins (admin_id, name, email, password_hash, role, status, invited_by, verified_at)
    VALUES (?, ?, ?, ?, 'super_admin', 'active', NULL, datetime('now'))
  `).run(adminId, name, email, bcrypt.hashSync(password, 10));
  logAudit(adminId, 'admin_created_via_cli', 'admin', adminId, null);

  console.log(`\nSuper admin ${adminId} created. Log in at /admin/login with ${email}.`);
}

main()
  .then(() => rl.close())
  .catch(err => {
    rl.close();
    console.error(`\nNot created: ${err.message}`);
    process.exit(1);
  });
