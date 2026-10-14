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

// Posts the upload form as the browser does (multipart), with optional files.
async function postUploadForm(fields, files) {
  const token = await admin.token('/admin/upload');
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const file of [].concat(files || [])) form.append(file.field, new Blob([file.content], { type: file.type }), file.name);
  const res = await admin.request(`/admin/upload?_csrf=${token}`, { method: 'POST', body: form });
  return { res, html: await res.text() };
}

const VIDEO = { field: 'videoFile', name: 'film.mp4', type: 'video/mp4', content: 'x' };
const TRAILER = { field: 'trailerFile', name: 'trailer.mp4', type: 'video/mp4', content: 'x' };
const VALID_FILM = { title: 'Field Error Film', description: 'A test film.', culture: 'Zulu', price: '45', genre: 'Drama', ageRating: 'PG' };

test('a rejected upload keeps what was typed and highlights the field to fix', async () => {
  const { res, html } = await postUploadForm({ ...VALID_FILM, title: '' },
    { field: 'thumbnailFile', name: 'thumb.png', type: 'image/png', content: 'not really a png' });
  assert.equal(res.status, 200);
  assert.match(html, /data-error-field="title"/);
  assert.match(html, /The field to fix is highlighted below/);
  assert.match(html, /A test film\./, 'the description is kept');
  assert.match(html, /name="price" id="priceInput" value="45"/, 'the price is kept');
  assert.match(html, /<option value="Drama" selected>/, 'the genre is kept');
  assert.match(html, /choose your video, trailer and thumbnail files again/, 'says chosen files must be picked again');
});

test('a file in the wrong format highlights that file field', async () => {
  const { html } = await postUploadForm(VALID_FILM,
    { field: 'trailerFile', name: 'trailer.avi', type: 'video/x-msvideo', content: 'x' });
  assert.match(html, /data-error-field="trailerFile"/);
  assert.match(html, /isn(&#39;|')t a supported format/);
});

test('an invalid new culture name highlights the culture box', async () => {
  const { html } = await postUploadForm({ ...VALID_FILM, culture: '__other__', newCulture: 'Zulu2' }, [VIDEO, TRAILER]);
  assert.match(html, /data-error-field="newCulture"/);
  assert.match(html, /value="Zulu2"/, 'the typed culture is kept');
});

test('the culture list offers the built-in cultures; choosing one not saved yet adds it', async () => {
  const { html } = await admin.page('/admin/upload');
  assert.match(html, /<option value="" selected disabled>Choose a culture…<\/option>/);
  assert.match(html, /<option value="Pedi"/, 'built-in cultures are listed');
  assert.match(html, /value="__other__"/, 'with an Other option');
  assert.doesNotMatch(html, /name="ageRating"/, 'no age rating is asked for');
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM cultures WHERE name = 'Pedi'").get().n, 0);

  const { res } = await postUploadForm({ ...VALID_FILM, title: 'Pedi Film', culture: 'Pedi', ageRating: '' }, [VIDEO, TRAILER]);
  assert.equal(res.status, 302, 'uploads without an age rating');
  const film = app.db.prepare("SELECT c.age_rating, cu.name FROM content c JOIN cultures cu USING (culture_id) WHERE c.title = 'Pedi Film'").get();
  assert.equal(film.name, 'Pedi');
  assert.equal(film.age_rating, null);
});

test('no culture chosen highlights the culture list', async () => {
  const { html } = await postUploadForm({ ...VALID_FILM, culture: '' }, [VIDEO, TRAILER]);
  assert.match(html, /data-error-field="culture"/);
});

test('every new film needs a trailer, even when the full video is there', async () => {
  const { html } = await postUploadForm({ ...VALID_FILM, title: 'No Trailer Film' }, VIDEO);
  assert.match(html, /data-error-field="trailerFile"/);
  assert.match(html, /Every film needs one/);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM content WHERE title = 'No Trailer Film'").get().n, 0);
});

test('thumbnail: choosing "Upload my own image" needs an image; a frame or the placeholder otherwise', async () => {
  const page = (await admin.page('/admin/upload')).html;
  assert.match(page, /name="thumbnailMode" value="frame" checked/, 'a frame from the video is the default');
  assert.match(page, /name="thumbnailMode" value="upload"/);

  const missing = await postUploadForm({ ...VALID_FILM, title: 'Own Image Film', thumbnailMode: 'upload' }, [VIDEO, TRAILER]);
  assert.match(missing.html, /data-error-field="thumbnailFile"/);
  assert.match(missing.html, /name="thumbnailMode" value="upload" checked/, 'the chosen option is kept');

  const framed = await postUploadForm({ ...VALID_FILM, title: 'Frame Film', thumbnailMode: 'frame' }, [VIDEO, TRAILER,
    { field: 'thumbnailFile', name: 'thumbnail.jpg', type: 'image/jpeg', content: 'jpeg' }]);
  assert.equal(framed.res.status, 302);
  assert.match(app.db.prepare("SELECT thumbnail_url FROM content WHERE title = 'Frame Film'").get().thumbnail_url, /^\/uploads\/.+\.jpg$/);
});

test('editing: the current thumbnail is kept unless another option is chosen', async () => {
  const filmId = app.db.prepare("SELECT content_id FROM content WHERE title = 'Frame Film'").get().content_id;
  const before = app.db.prepare('SELECT thumbnail_url FROM content WHERE content_id = ?').get(filmId).thumbnail_url;
  const { html } = await admin.page(`/admin/films/${filmId}/edit`);
  assert.match(html, /name="thumbnailMode" value="keep" checked/);
  assert.doesNotMatch(html, /<label for="trailerInput"[^>]*>Trailer File <span/, 'a film with a trailer needs no new one');

  const token = await admin.token(`/admin/films/${filmId}/edit`);
  const form = new FormData();
  for (const [k, v] of Object.entries({ ...VALID_FILM, title: 'Frame Film', thumbnailMode: 'keep' })) form.append(k, v);
  const res = await admin.request(`/admin/films/${filmId}/edit?_csrf=${token}`, { method: 'POST', body: form });
  assert.equal(res.status, 302);
  assert.equal(app.db.prepare('SELECT thumbnail_url FROM content WHERE content_id = ?').get(filmId).thumbnail_url, before);
});
