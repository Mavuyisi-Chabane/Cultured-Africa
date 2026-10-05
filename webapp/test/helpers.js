// Shared helpers for the automated tests (npm test).
//
// Each test file starts its own copy of the app (server.js) on a free port, with a brand
// new temporary database (filled with the demo data), its own uploads folder and email
// inbox folder, and a fake Paystack. Nothing touches the real database, real email or
// real Paystack, and everything is deleted when the file's tests finish.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PASSWORD = 'Passw0rd!';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);   // low cost: fast tests, same check

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

// A stand-in for Paystack's "verify transaction" API. Tests register what a payment
// reference should look like with pay(); anything else is "not found".
async function startFakePaystack() {
  const payments = new Map();
  const server = http.createServer((req, res) => {
    const match = /^\/transaction\/verify\/(.+)$/.exec(req.url);
    const tx = match && payments.get(decodeURIComponent(match[1]));
    res.setHeader('content-type', 'application/json');
    if (!tx) return res.end(JSON.stringify({ status: false, message: 'Transaction reference not found' }));
    res.end(JSON.stringify({ status: true, data: tx }));
  });
  const port = await freePort();
  await new Promise(r => server.listen(port, r));
  return {
    url: `http://localhost:${port}`,
    pay(reference, { amountRand, email, currency = 'ZAR', status = 'success' }) {
      payments.set(reference, {
        status, reference, currency, amount: Math.round(amountRand * 100), channel: 'card',
        customer: { email }, authorization: { brand: 'visa', card_type: 'visa', last4: '4081' }
      });
    },
    close: () => new Promise(r => server.close(r))
  };
}

async function startApp(extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cultured-africa-test-'));
  const port = await freePort();
  const paystack = await startFakePaystack();
  const paths = {
    db: path.join(dir, 'test.sqlite'),
    uploads: path.join(dir, 'uploads'),
    inbox: path.join(dir, 'inbox')
  };
  fs.mkdirSync(paths.uploads);

  // Every setting is given explicitly, so nothing is picked up from the developer's .env.
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DB_PATH: paths.db,
    UPLOADS_DIR: paths.uploads,
    DEV_INBOX_DIR: paths.inbox,
    APP_BASE_URL: `http://localhost:${port}`,
    SESSION_SECRET: 'test-session-secret-that-is-long-enough-123',
    SEED_DEMO_DATA: 'true',
    SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '',
    MAIL_FROM: 'Cultured Africa <no-reply@culturedafrica.co.za>',
    PAYSTACK_PUBLIC_KEY: 'pk_test_fake', PAYSTACK_SECRET_KEY: 'sk_test_fake',
    PAYSTACK_API_BASE: paystack.url, PAYSTACK_CURRENCY: 'ZAR',
    BUSINESS_EMAIL: 'info@culturedafrica.co.za',
    BACKUP_DIR: '',
    ...extraEnv
  };

  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });

  const url = `http://localhost:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The app stopped while starting:\n${output}`);
    try { if ((await fetch(url + '/health')).ok) break; } catch { /* not up yet */ }
    if (Date.now() - started > 30000) { child.kill(); throw new Error(`The app did not start within 30s:\n${output}`); }
    await new Promise(r => setTimeout(r, 150));
  }

  const db = new DatabaseSync(paths.db);
  db.exec('PRAGMA busy_timeout = 5000');

  const app = {
    url, db, paystack, paths,
    output: () => output,

    // Reads (and removes) the newest email sent to an address, waiting briefly for
    // emails that are sent in the background (receipts, security alerts).
    async mail(to, timeoutMs = 3000) {
      const file = path.join(paths.inbox, `${to.replace(/[^a-z0-9.@-]/gi, '_')}.json`);
      const until = Date.now() + timeoutMs;
      while (!fs.existsSync(file)) {
        if (Date.now() > until) return null;
        await new Promise(r => setTimeout(r, 50));
      }
      const message = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.unlinkSync(file);
      return message;
    },

    // A verified customer who has accepted the current privacy policy.
    createCustomer({ name = 'Test Customer', email, consent = true, verified = true, adult = false } = {}) {
      const policy = consent ? require(path.join(ROOT, 'config', 'privacy')).PRIVACY_POLICY_VERSION : null;
      return Number(db.prepare(`
        INSERT INTO users (full_name, email, password_hash, is_verified, role, privacy_consent_at, privacy_policy_version, adult_confirmed_at)
        VALUES (?, ?, ?, ?, 'customer', ${consent ? "datetime('now')" : 'NULL'}, ?, ${adult ? "datetime('now')" : 'NULL'})
      `).run(name, email, PASSWORD_HASH, verified ? 1 : 0, policy).lastInsertRowid);
    },

    filmId(title) {
      const row = db.prepare('SELECT content_id FROM content WHERE title = ?').get(title);
      if (!row) throw new Error(`No film called "${title}" in the demo data`);
      return Number(row.content_id);
    },

    // Gives a film a real (tiny) video file, so streaming can be tested.
    giveFilmAVideo(contentId) {
      const name = `test-film-${contentId}.mp4`;
      fs.writeFileSync(path.join(paths.uploads, name), Buffer.alloc(2048, 1));
      db.prepare('UPDATE content SET file_url = ? WHERE content_id = ?').run(`/uploads/${name}`, contentId);
      return `/uploads/${name}`;
    },

    async stop() {
      try { db.close(); } catch { /* already closed */ }
      await paystack.close();
      if (child.exitCode === null) {
        await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
      }
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };
  return app;
}

// HTML-escaped text back to plain text, so tests can look for "can't" rather than "can&#39;t".
function decode(html) {
  return html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// A browser stand-in: keeps cookies between requests and fills in the CSRF token.
class Client {
  constructor(app) { this.app = app; this.cookies = {}; }

  async request(pathname, options = {}) {
    const res = await fetch(this.app.url + pathname, {
      redirect: 'manual',
      ...options,
      headers: { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '), ...(options.headers || {}) }
    });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return res;
  }

  get(pathname) { return this.request(pathname); }

  // GET a page and return its decoded HTML.
  async page(pathname) {
    const res = await this.get(pathname);
    return { res, html: decode(await res.text()) };
  }

  // The CSRF token from a page's forms.
  async token(fromPath = '/login') {
    const html = await (await this.get(fromPath)).text();
    const m = html.match(/name="_csrf" value="([a-f0-9]+)"/) || html.match(/_csrf=([a-f0-9]+)/);
    if (!m) throw new Error(`No CSRF token found on ${fromPath}`);
    return m[1];
  }

  // Submit a form (fetching a fresh CSRF token from `from` first). Returns { res, html }.
  async submit(pathname, data = {}, { from = pathname, csrf = true } = {}) {
    const body = new URLSearchParams(data);
    if (csrf) body.set('_csrf', await this.token(from));
    const res = await this.request(pathname, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const html = res.status >= 300 && res.status < 400 ? '' : decode(await res.text());
    return { res, html, location: res.headers.get('location') };
  }

  async postJson(pathname, data, { from }) {
    const token = await this.token(from);
    const res = await this.request(pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify(data) });
    return res;
  }

  async login(email, password = PASSWORD, extra = {}) {
    return this.submit('/login', { email, password, ...extra }, { from: '/login' });
  }

  async adminLogin(email = 'admin@culturedafrica.co.za', password = 'admin123') {
    await this.submit('/admin/login/continue', { email }, { from: '/admin/login' });
    return this.submit('/admin/login/password', { email, password }, { from: '/admin/login' });
  }
}

module.exports = { startApp, Client, decode, PASSWORD };
