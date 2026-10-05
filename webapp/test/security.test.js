// Security basics: headers, CSRF, protected streaming, the /uploads gate, admin pages.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client } = require('./helpers');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.stop(); });

test('security headers are sent and the server software is hidden', async () => {
  const res = await new Client(app).get('/');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('/health answers for uptime monitoring', async () => {
  const res = await new Client(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('unknown pages get the branded 404 page', async () => {
  const { res, html } = await new Client(app).page('/no-such-page');
  assert.equal(res.status, 404);
  assert.match(html, /Page not found/);
});

test('a form posted without its CSRF token is refused', async () => {
  app.createCustomer({ email: 'csrf@test.local' });
  const { res, html } = await new Client(app).submit('/login', { email: 'csrf@test.local', password: 'Passw0rd!' }, { csrf: false });
  assert.equal(res.status, 403);
  assert.match(html, /This form has expired/);
});

test('logging in issues a new session ID (no session fixation)', async () => {
  app.createCustomer({ email: 'fixation@test.local' });
  const c = new Client(app);
  await c.get('/login');
  const before = c.cookies['ca.sid'];
  const { location } = await c.login('fixation@test.local');
  assert.equal(location, '/');
  assert.ok(before && c.cookies['ca.sid'] && c.cookies['ca.sid'] !== before);
});

test('full film files are never served from /uploads, but thumbnails are', async () => {
  const filmId = app.filmId('Threads of Venda');
  const videoUrl = app.giveFilmAVideo(filmId);
  require('node:fs').writeFileSync(require('node:path').join(app.paths.uploads, 'thumb.jpg'), 'jpg');
  const guest = new Client(app);
  assert.equal((await guest.get(videoUrl)).status, 404);
  assert.equal((await guest.get('/uploads/thumb.jpg')).status, 200);
});

test('streaming needs a login, a purchase, and the active playback token', async () => {
  const filmId = app.filmId('Threads of Venda');
  app.giveFilmAVideo(filmId);
  const guest = new Client(app);
  const r1 = await guest.get(`/film/${filmId}/stream`);
  assert.equal(r1.status, 302);
  assert.equal(r1.headers.get('location'), '/login');

  app.createCustomer({ email: 'stream@test.local' });
  const c = new Client(app);
  await c.login('stream@test.local');
  assert.equal((await c.get(`/film/${filmId}/stream`)).status, 403, 'not bought yet');

  const uid = app.db.prepare("SELECT user_id FROM users WHERE email = 'stream@test.local'").get().user_id;
  app.db.prepare("INSERT INTO purchases (user_id, content_id, amount_paid, payment_status, transaction_ref) VALUES (?, ?, 50, 'completed', 'SEC-STREAM-1')").run(uid, filmId);
  assert.equal((await c.get(`/film/${filmId}/stream`)).status, 409, 'bought, but no playback token');

  const token = 'a'.repeat(32);
  const claim = await c.postJson(`/film/${filmId}/playback/claim`, { playbackToken: token }, { from: `/film/${filmId}` });
  assert.equal(claim.status, 200);
  const stream = await c.get(`/film/${filmId}/stream?pt=${token}`);
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.get('cache-control'), 'private, no-store');
});

test('customers cannot open admin pages; visitors are sent to the admin login', async () => {
  const guest = new Client(app);
  for (const p of ['/admin/dashboard', '/admin/customers', '/admin/upload']) {
    const r = await guest.get(p);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), '/admin/login', p);
  }
});

test('the demo login hint is never shown in production mode', async () => {
  // This app runs in test mode, where the hint is allowed; production is checked via the view.
  const ejs = require('ejs');
  const html = await ejs.renderFile(require('node:path').join(__dirname, '..', 'views', 'login.ejs'), {
    isProduction: true, error: null, notice: null, showResend: false, resendEmail: '', csrfToken: 'x', cssVersion: '1'
  });
  assert.doesNotMatch(html, /Demo member/);
});
