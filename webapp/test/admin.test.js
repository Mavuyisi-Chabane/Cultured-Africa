// The admin portal: login, customers (suspend/reactivate), cultures, films, feedback.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client } = require('./helpers');

let app, admin;
before(async () => {
  app = await startApp();
  admin = new Client(app);
  const { location } = await admin.adminLogin();
  assert.equal(location, '/admin/dashboard');
});
after(async () => { await app.stop(); });

test('admin login rejects a wrong password', async () => {
  const { html } = await new Client(app).adminLogin('admin@culturedafrica.co.za', 'wrong');
  assert.match(html, /Incorrect email or password/);
});

test('admin login does not reveal whether an email is an admin', async () => {
  const unknown = await new Client(app).submit('/admin/login/continue', { email: 'nobody@test.local' }, { from: '/admin/login' });
  const known = await new Client(app).submit('/admin/login/continue', { email: 'admin@culturedafrica.co.za' }, { from: '/admin/login' });
  const strip = h => h.replace(/nobody@test\.local|admin@culturedafrica\.co\.za/g, 'EMAIL').replace(/value="[a-f0-9]{20,}"/g, '');
  assert.equal(strip(unknown.html), strip(known.html));
});

test('every admin page opens', async () => {
  for (const p of ['/admin/dashboard', '/admin/films', '/admin/upload', '/admin/feedback', '/admin/customers', '/admin/cultures', '/admin/activity', '/admin/reports', '/admin/manage-admins']) {
    const { res } = await admin.page(p);
    assert.equal(res.status, 200, p);
  }
});

test('suspending a customer logs them out at once; reactivating restores access', async () => {
  const id = app.createCustomer({ email: 'suspend-me@test.local' });
  const customer = new Client(app);
  await customer.login('suspend-me@test.local');
  assert.equal((await customer.get('/account')).status, 200);

  await admin.submit(`/admin/customers/${id}/suspend`, { reason: 'Testing' }, { from: '/admin/customers' });
  assert.equal(app.db.prepare('SELECT status FROM users WHERE user_id = ?').get(id).status, 'suspended');
  assert.equal((await customer.get('/account')).status, 302, 'logged out on the next click');
  assert.match((await new Client(app).login('suspend-me@test.local')).html, /suspended/);

  await admin.submit(`/admin/customers/${id}/reactivate`, {}, { from: '/admin/customers' });
  assert.equal((await new Client(app).login('suspend-me@test.local')).location, '/');
});

test('a suspended account is refused on its next request even if its session is still valid', async () => {
  const id = app.createCustomer({ email: 'status-only@test.local' });
  const customer = new Client(app);
  await customer.login('status-only@test.local');
  app.db.prepare("UPDATE users SET status = 'suspended' WHERE user_id = ?").run(id);   // session_version unchanged
  assert.equal((await customer.get('/account')).status, 302);
});

test('customer search finds by name or email', async () => {
  app.createCustomer({ email: 'findme@test.local', name: 'Zanele Findable' });
  const { html } = await admin.page('/admin/customers?q=findable');
  assert.match(html, /findme@test\.local/);
  assert.doesNotMatch(html, /member@culturedafrica\.co\.za/);
});

test('cultures: add, reject duplicates, and block removing one that films use', async () => {
  await admin.submit('/admin/cultures', { name: 'Pedi', region: 'Limpopo', description: '' }, { from: '/admin/cultures' });
  const pedi = app.db.prepare("SELECT * FROM cultures WHERE name = 'Pedi'").get();
  assert.ok(pedi);
  const dup = await admin.submit('/admin/cultures', { name: 'pedi', region: '', description: '' }, { from: '/admin/cultures' });
  assert.equal(dup.res.status, 400);

  const used = app.db.prepare('SELECT culture_id, name FROM cultures WHERE culture_id IN (SELECT culture_id FROM content) LIMIT 1').get();
  const blocked = await admin.submit(`/admin/cultures/${used.culture_id}/delete`, {}, { from: '/admin/cultures' });
  assert.match(blocked.html, /can't be removed because/);

  await admin.submit(`/admin/cultures/${pedi.culture_id}/delete`, {}, { from: '/admin/cultures' });
  assert.equal(app.db.prepare("SELECT 1 FROM cultures WHERE name = 'Pedi'").get(), undefined);
});

test('archiving a film hides it from customers', async () => {
  const filmId = app.filmId('Threads of Venda');
  await admin.submit(`/admin/films/${filmId}/toggle-availability`, {}, { from: '/admin/films' });
  assert.equal(app.db.prepare('SELECT is_available FROM content WHERE content_id = ?').get(filmId).is_available, 0);
  assert.doesNotMatch((await new Client(app).page('/films')).html, /Threads of Venda/);
  await admin.submit(`/admin/films/${filmId}/toggle-availability`, {}, { from: '/admin/films' });
});

test('removing a review hides it on the film page', async () => {
  const uid = app.createCustomer({ email: 'reviewer@test.local' });
  const filmId = app.filmId('Ubuntu: The Eternal Bond');
  const fid = Number(app.db.prepare("INSERT INTO feedback (content_id, user_id, rating, comment) VALUES (?, ?, 2, 'Remove me please')").run(filmId, uid).lastInsertRowid);
  assert.match((await new Client(app).page(`/film/${filmId}`)).html, /Remove me please/);
  await admin.submit(`/admin/feedback/${fid}/delete`, { reason: 'Spam' }, { from: '/admin/feedback' });
  assert.doesNotMatch((await new Client(app).page(`/film/${filmId}`)).html, /Remove me please/);
});

test('admins cannot use customer pages, and customers cannot use admin pages', async () => {
  const r = await admin.get('/library');
  assert.equal(r.status, 302);
  app.createCustomer({ email: 'not-admin@test.local' });
  const c = new Client(app);
  await c.login('not-admin@test.local');
  assert.equal((await c.get('/admin/dashboard')).headers.get('location'), '/admin/login');
});

test('Backups: a super admin can take a backup and download it', async () => {
  const taken = await admin.submit('/admin/backups', {}, { from: '/admin/backups' });
  assert.equal(taken.location, '/admin/backups?msg=created');
  const { html } = await admin.page('/admin/backups');
  const name = html.match(/href="\/admin\/backups\/(cultured-africa-[^"]+\.sqlite)"/)[1];
  const file = await admin.get(`/admin/backups/${name}`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /attachment/);
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3', 'a real database file');
  assert.ok(app.db.prepare("SELECT 1 FROM admin_audit_log WHERE action = 'downloaded_backup'").get(), 'download is logged');
});

test('Backups: only super admins, and only files from the backup list', async () => {
  const plainAdmin = new Client(app);
  await plainAdmin.adminLogin('ntk.testing12@gmail.com', 'Testing12');
  assert.equal((await plainAdmin.get('/admin/backups')).status, 403);
  assert.equal((await new Client(app).get('/admin/backups')).headers.get('location'), '/admin/login');
  assert.equal((await admin.get('/admin/backups/..%2Ftest.sqlite')).status, 404);
  assert.equal((await admin.get('/admin/backups/test.sqlite')).status, 404);
});
