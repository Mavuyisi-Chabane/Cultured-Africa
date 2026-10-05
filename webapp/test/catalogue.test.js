// Browsing and search, film labels (genre, length), Continue watching.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client } = require('./helpers');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.stop(); });

test('visitors can browse the catalogue and open film pages without an account', async () => {
  const guest = new Client(app);
  const list = await guest.page('/films');
  assert.equal(list.res.status, 200);
  assert.match(list.html, /Echoes of the Highveld/);
  const film = await guest.page(`/film/${app.filmId('Echoes of the Highveld')}`);
  assert.equal(film.res.status, 200);
  assert.match(film.html, /Log in to buy/);
});

test('search matches any letter case and highlights the words in the description', async () => {
  const { html } = await new Client(app).page('/films?q=DRAKENSBERG');
  assert.match(html, /Echoes of the Highveld/);
  assert.match(html, /<mark>Drakensberg<\/mark>/);
  assert.doesNotMatch(html, /Mountain Guardians/);
  const none = await new Client(app).page('/films?q=zzzznotafilm');
  assert.match(none.html, /No films match/);
});

test('logged-in customers browsing /films are taken to Home with their search kept', async () => {
  app.createCustomer({ email: 'browse@test.local' });
  const c = new Client(app);
  await c.login('browse@test.local');
  const r = await c.get('/films?q=venda');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/?q=venda');
});

test('cards show culture, genre and length; unset genres are hidden', async () => {
  const id = app.filmId('Ukudweba');
  app.db.prepare("UPDATE content SET content_type = 'Uncategorized', duration_seconds = 4320 WHERE content_id = ?").run(id);
  let { html } = await new Client(app).page('/films?q=Ukudweba');
  assert.doesNotMatch(html, /Uncategorized/);
  assert.match(html, /1 h 12 min/);
  app.db.prepare("UPDATE content SET content_type = 'Documentary' WHERE content_id = ?").run(id);
  ({ html } = await new Client(app).page('/films?q=Ukudweba'));
  assert.match(html, /Heritage · Documentary · 1 h 12 min/);
});

test('archived films are hidden from the catalogue', async () => {
  const id = app.filmId('City of Gold');
  app.db.prepare('UPDATE content SET is_available = 0 WHERE content_id = ?').run(id);
  const { html } = await new Client(app).page('/films');
  assert.doesNotMatch(html, /City of Gold/);
  app.db.prepare('UPDATE content SET is_available = 1 WHERE content_id = ?').run(id);
});

test('Continue watching: started, playable films only, most recent first', async () => {
  const uid = app.createCustomer({ email: 'watcher@test.local' });
  const free1 = app.filmId('Ubuntu: The Eternal Bond');
  const free2 = app.filmId('Mountain Guardians');
  const paid = app.filmId('Threads of Venda');
  app.db.prepare('UPDATE content SET duration_seconds = 3600 WHERE content_id IN (?, ?, ?)').run(free1, free2, paid);
  const progress = app.db.prepare("INSERT INTO watch_progress (user_id, content_id, position_seconds, completed, updated_at) VALUES (?, ?, ?, ?, datetime('now', ?))");
  progress.run(uid, free1, 900, 0, '-1 hour');      // 15 min in
  progress.run(uid, free2, 1800, 0, '-5 minutes');  // half way, most recent
  progress.run(uid, paid, 600, 0, '-2 hours');      // not bought: left out

  const c = new Client(app);
  await c.login('watcher@test.local');
  let { html } = await c.page('/');
  const row = (html.match(/<section[^>]*continue-heading[\s\S]*?<\/section>/) || [''])[0];
  const titles = [...row.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(m => m[1].trim());
  assert.deepEqual(titles, ['Mountain Guardians', 'Ubuntu: The Eternal Bond']);
  assert.match(row, /30 min left/);
  assert.match(row, new RegExp(`/film/${free2}#playerFrame`));

  ({ html } = await c.page('/?q=ubuntu'));
  assert.doesNotMatch(html, /continue-heading/, 'hidden while searching');

  app.db.prepare('UPDATE watch_progress SET completed = 1 WHERE user_id = ?').run(uid);
  ({ html } = await c.page('/'));
  assert.doesNotMatch(html, /continue-heading/, 'finished films leave the row');
});

test('playback progress is saved and the film resumes there', async () => {
  const uid = app.createCustomer({ email: 'resume@test.local' });
  const filmId = app.filmId('Mountain Guardians');
  app.giveFilmAVideo(filmId);
  const c = new Client(app);
  await c.login('resume@test.local');
  const page = await c.page(`/film/${filmId}`);
  const viewId = Number(page.html.match(/var viewId = (\d+)/)[1]);
  const token = 'c'.repeat(32);
  await c.postJson(`/film/${filmId}/playback/claim`, { playbackToken: token }, { from: `/film/${filmId}` });
  await c.postJson(`/film/${filmId}/track-progress`, { viewId, progressSeconds: 125, completed: false, playbackToken: token }, { from: `/film/${filmId}` });
  assert.equal(app.db.prepare('SELECT position_seconds FROM watch_progress WHERE user_id = ? AND content_id = ?').get(uid, filmId).position_seconds, 125);
  assert.match((await c.page(`/film/${filmId}`)).html, /var resumeSeconds = 125;/);
});
