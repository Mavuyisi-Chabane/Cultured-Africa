// Registration, email verification, login, Remember me, password reset, logout.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client } = require('./helpers');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.stop(); });

const register = (c, fields) => c.submit('/register', {
  fullName: 'New Viewer', email: 'new@test.local', password: 'Str0ng!Pass', confirm: 'Str0ng!Pass', privacyConsent: 'yes', ...fields
}, { from: '/register' });

test('registration requires agreeing to the Privacy Policy (POPIA)', async () => {
  const { html } = await register(new Client(app), { email: 'noconsent@test.local', privacyConsent: '' });
  assert.match(html, /Please agree to the Privacy Policy/);
  assert.equal(app.db.prepare("SELECT 1 FROM users WHERE email = 'noconsent@test.local'").get(), undefined);
});

test('registration enforces the password rules', async () => {
  const { html } = await register(new Client(app), { email: 'weak@test.local', password: 'weak', confirm: 'weak' });
  assert.match(html, /Password must include/);
});

test('register, verify with the emailed code, then log in', async () => {
  const c = new Client(app);
  await register(c, { email: 'verify@test.local' });
  const user = app.db.prepare("SELECT * FROM users WHERE email = 'verify@test.local'").get();
  assert.equal(user.is_verified, 0);
  assert.ok(user.privacy_consent_at, 'consent date recorded');

  // Can't log in before verifying.
  const early = await new Client(app).login('verify@test.local', 'Str0ng!Pass');
  assert.match(early.html, /Please verify your email/);

  const mail = await app.mail('verify@test.local');
  assert.equal(mail.subject, 'Your Cultured Africa verification code');
  const code = mail.text.match(/\b(\d{6})\b/)[1];

  const wrong = await c.submit('/verify-email', { email: 'verify@test.local', code: code === '000000' ? '111111' : '000000' }, { from: '/verify-email' });
  assert.match(wrong.html, /Incorrect code/);

  await c.submit('/verify-email', { email: 'verify@test.local', code }, { from: '/verify-email' });
  assert.equal(app.db.prepare("SELECT is_verified FROM users WHERE email = 'verify@test.local'").get().is_verified, 1);

  const { location } = await new Client(app).login('verify@test.local', 'Str0ng!Pass');
  assert.equal(location, '/');
});

test('a duplicate email cannot register twice', async () => {
  app.createCustomer({ email: 'taken@test.local' });
  const { html } = await register(new Client(app), { email: 'taken@test.local' });
  assert.match(html, /already exists/);
});

test('wrong password shows one generic message', async () => {
  app.createCustomer({ email: 'generic@test.local' });
  const { html } = await new Client(app).login('generic@test.local', 'nope');
  assert.match(html, /Incorrect email or password/);
  const { html: html2 } = await new Client(app).login('nobody@test.local', 'nope');
  assert.match(html2, /Incorrect email or password/);
});

test('repeated wrong passwords are rate-limited, but a correct login resets the count', async () => {
  app.createCustomer({ email: 'limit@test.local' });
  const c = new Client(app);
  let last;
  for (let i = 0; i < 11; i++) last = await c.login('limit@test.local', 'wrong-' + i);
  assert.match(last.html, /Too many login attempts/);

  app.createCustomer({ email: 'reset-count@test.local' });
  for (let i = 0; i < 12; i++) {
    const r = await new Client(app).login('reset-count@test.local');
    assert.equal(r.location, '/', `successful login ${i + 1} must not be blocked`);
  }
});

test('Remember me keeps the session for 30 days; otherwise 4 hours', async () => {
  app.createCustomer({ email: 'remember@test.local' });
  const expiryDays = res => {
    const cookie = res.headers.getSetCookie().find(c => c.startsWith('ca.sid='));
    return (new Date(cookie.match(/Expires=([^;]+)/i)[1]) - Date.now()) / 86400000;
  };
  const plain = await new Client(app).login('remember@test.local');
  assert.ok(Math.abs(expiryDays(plain.res) * 24 - 4) < 0.05, 'about 4 hours');
  const remembered = await new Client(app).login('remember@test.local', 'Passw0rd!', { remember: 'yes' });
  assert.ok(Math.abs(expiryDays(remembered.res) - 30) < 0.05, 'about 30 days');
});

test('password reset: emailed link works once and logs out other sessions', async () => {
  app.createCustomer({ email: 'forgot@test.local' });
  const other = new Client(app);
  await other.login('forgot@test.local');
  assert.equal((await other.get('/account')).status, 200);

  const c = new Client(app);
  const sent = await c.submit('/forgot-password', { email: 'forgot@test.local' }, { from: '/forgot-password' });
  assert.ok(sent.html.length > 0);
  const mail = await app.mail('forgot@test.local');
  assert.equal(mail.subject, 'Reset your Cultured Africa password');
  const link = mail.text.match(/(http\S+reset-password\?token=[a-f0-9]+)/)[1];
  const token = new URL(link).searchParams.get('token');

  const form = await c.page(`/reset-password?token=${token}`);
  assert.equal(form.res.status, 200);
  const done = await c.submit('/reset-password', { token, password: 'N3w!Passw0rd', confirm: 'N3w!Passw0rd' }, { from: `/reset-password?token=${token}` });
  assert.doesNotMatch(done.html, /invalid|expired/i);

  assert.equal((await other.get('/account')).status, 302, 'old session logged out');
  assert.equal((await new Client(app).login('forgot@test.local', 'N3w!Passw0rd')).location, '/');
  const again = await c.page(`/reset-password?token=${token}`);
  assert.match(again.html, /invalid|expired|already/i, 'link cannot be reused');
});

test('forgot password does not reveal whether an email has an account', async () => {
  const a = await new Client(app).submit('/forgot-password', { email: 'ghost@test.local' }, { from: '/forgot-password' });
  app.createCustomer({ email: 'real@test.local' });
  const b = await new Client(app).submit('/forgot-password', { email: 'real@test.local' }, { from: '/forgot-password' });
  const strip = h => h.replace(/ghost@test\.local|real@test\.local/g, 'EMAIL').replace(/value="[a-f0-9]{20,}"/g, '');
  assert.equal(strip(a.html), strip(b.html));
  await app.mail('real@test.local');
});

test('logout ends the session', async () => {
  app.createCustomer({ email: 'logout@test.local' });
  const c = new Client(app);
  await c.login('logout@test.local');
  await c.submit('/logout', {}, { from: '/account' });
  assert.equal((await c.get('/account')).status, 302);
});

test('a suspended customer cannot log in', async () => {
  const id = app.createCustomer({ email: 'suspended@test.local' });
  app.db.prepare("UPDATE users SET status = 'suspended' WHERE user_id = ?").run(id);
  const { html } = await new Client(app).login('suspended@test.local');
  assert.match(html, /This account has been suspended/);
});

test('existing customers without consent are asked to accept the Privacy Policy', async () => {
  app.createCustomer({ email: 'noconsent-yet@test.local', consent: false });
  const c = new Client(app);
  await c.login('noconsent-yet@test.local');
  const r = await c.get('/library');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/consent');
});
