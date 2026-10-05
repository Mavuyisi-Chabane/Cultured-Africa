// Reviews: who may review, the language filter, editing and deleting your own.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client } = require('./helpers');

let app, freeFilm, paidFilm;
before(async () => {
  app = await startApp();
  freeFilm = app.filmId('Ubuntu: The Eternal Bond');
  paidFilm = app.filmId('Echoes of the Highveld');
});
after(async () => { await app.stop(); });

async function customer(email) {
  const id = app.createCustomer({ email, name: email.split('@')[0] });
  const c = new Client(app);
  await c.login(email);
  return { id, c };
}
const review = (c, filmId, fields) => c.submit(`/film/${filmId}/review`, fields, { from: `/film/${filmId}` });
const reviewOf = (userId, filmId) => app.db.prepare('SELECT * FROM feedback WHERE user_id = ? AND content_id = ?').get(userId, filmId);

test('only viewers who bought the film (or free films) can review', async () => {
  const { id, c } = await customer('nobuy@test.local');
  const { html } = await review(c, paidFilm, { rating: '5', comment: 'Great' });
  assert.match(html, /You can only review films you have bought/);
  assert.equal(reviewOf(id, paidFilm), undefined);
  await review(c, freeFilm, { rating: '4', comment: 'Lovely' });
  assert.equal(reviewOf(id, freeFilm).rating, 4);
});

test('a review needs a rating or a comment, and the rating must be 1-5', async () => {
  const { c } = await customer('empty@test.local');
  assert.match((await review(c, freeFilm, { rating: '', comment: '' })).html, /Please provide a rating, a comment, or both/);
  assert.match((await review(c, freeFilm, { rating: '9', comment: '' })).html, /Rating must be between 1 and 5/);
});

test('comments with bad language are not published', async () => {
  const { id, c } = await customer('rude@test.local');
  const { html } = await review(c, freeFilm, { rating: '1', comment: 'This is shit' });
  assert.match(html, /inappropriate language/);
  assert.equal(reviewOf(id, freeFilm), undefined);
});

test('customers can edit their own review, and it is marked "(edited)"', async () => {
  const { id, c } = await customer('editor@test.local');
  await review(c, freeFilm, { rating: '3', comment: 'Good' });
  const r = reviewOf(id, freeFilm);
  const page = await c.page(`/film/${freeFilm}`);
  assert.match(page.html, /Your review/);
  assert.match(page.html, new RegExp(`/film/${freeFilm}/review/${r.feedback_id}/edit`));

  await c.submit(`/film/${freeFilm}/review/${r.feedback_id}/edit`, { rating: '5', comment: 'Even better the second time' }, { from: `/film/${freeFilm}` });
  const edited = reviewOf(id, freeFilm);
  assert.equal(edited.rating, 5);
  assert.equal(edited.comment, 'Even better the second time');
  assert.ok(edited.edited_at);
  assert.match((await c.page(`/film/${freeFilm}`)).html, /\(edited\)/);

  const rude = await c.submit(`/film/${freeFilm}/review/${r.feedback_id}/edit`, { rating: '5', comment: 'shit' }, { from: `/film/${freeFilm}` });
  assert.match(rude.html, /inappropriate language/);
});

test('customers can delete their own review', async () => {
  const { id, c } = await customer('deleter@test.local');
  await review(c, freeFilm, { rating: '2', comment: 'Not for me' });
  const r = reviewOf(id, freeFilm);
  await c.submit(`/film/${freeFilm}/review/${r.feedback_id}/delete`, {}, { from: `/film/${freeFilm}` });
  assert.equal(reviewOf(id, freeFilm), undefined);
});

test("nobody can edit or delete someone else's review", async () => {
  const { id, c: owner } = await customer('owner@test.local');
  await review(owner, freeFilm, { rating: '4', comment: 'Mine' });
  const r = reviewOf(id, freeFilm);
  const { c: other } = await customer('intruder@test.local');
  assert.doesNotMatch((await other.page(`/film/${freeFilm}`)).html, new RegExp(`review/${r.feedback_id}/edit`));
  assert.equal((await other.submit(`/film/${freeFilm}/review/${r.feedback_id}/edit`, { rating: '1', comment: 'hacked' }, { from: `/film/${freeFilm}` })).res.status, 404);
  assert.equal((await other.submit(`/film/${freeFilm}/review/${r.feedback_id}/delete`, {}, { from: `/film/${freeFilm}` })).res.status, 404);
  assert.equal(reviewOf(id, freeFilm).comment, 'Mine');
});

test('a review removed by an admin cannot be edited back', async () => {
  const { id, c } = await customer('removed@test.local');
  await review(c, freeFilm, { rating: '4', comment: 'Hello' });
  const r = reviewOf(id, freeFilm);
  app.db.prepare("UPDATE feedback SET status = 'removed' WHERE feedback_id = ?").run(r.feedback_id);
  assert.equal((await c.submit(`/film/${freeFilm}/review/${r.feedback_id}/edit`, { rating: '5', comment: 'back' }, { from: `/film/${freeFilm}` })).res.status, 404);
});
