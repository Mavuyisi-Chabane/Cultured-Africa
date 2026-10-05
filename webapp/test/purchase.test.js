// Buying a film (with a fake Paystack), receipts, the 6-month access period, the 18+
// confirmation and one device at a time.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client } = require('./helpers');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.stop(); });

async function customer(email, opts) {
  const id = app.createCustomer({ email, ...opts });
  const c = new Client(app);
  await c.login(email);
  return { id, c };
}
const buy = (c, filmId, reference) => c.submit(`/film/${filmId}/buy`, { reference }, { from: `/film/${filmId}` });
const purchases = (userId, filmId) => app.db.prepare("SELECT * FROM purchases WHERE user_id = ? AND content_id = ? AND payment_status = 'completed'").all(userId, filmId);

test('a verified Paystack payment unlocks the film and emails a receipt', async () => {
  const { id, c } = await customer('buyer@test.local');
  const filmId = app.filmId('Echoes of the Highveld');   // R50
  app.paystack.pay('REF-OK-1', { amountRand: 50, email: 'buyer@test.local' });

  const { location } = await buy(c, filmId, 'REF-OK-1');
  assert.equal(location, `/film/${filmId}`);
  const [p] = purchases(id, filmId);
  assert.equal(p.amount_paid, 50);
  assert.equal(p.card_last4, '4081');

  const mail = await app.mail('buyer@test.local');
  assert.match(mail.subject, /^Your Cultured Africa receipt CA-\d{4}-\d{6}: Echoes of the Highveld$/);

  const { html } = await c.page(`/film/${filmId}`);
  assert.match(html, /Access until/);
  assert.ok(app.db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND type = 'purchase_confirmation'").get(id));
});

test('the receipt is on the Account page and only its owner can open it', async () => {
  const { id, c } = await customer('receipt@test.local');
  const filmId = app.filmId('Threads of Venda');
  app.paystack.pay('REF-RECEIPT', { amountRand: 50, email: 'receipt@test.local' });
  await buy(c, filmId, 'REF-RECEIPT');
  await app.mail('receipt@test.local');
  const purchaseId = purchases(id, filmId)[0].purchase_id;

  const account = await c.page('/account');
  assert.match(account.html, new RegExp(`/account/purchases/${purchaseId}/receipt`));
  const own = await c.page(`/account/purchases/${purchaseId}/receipt`);
  assert.equal(own.res.status, 200);
  assert.match(own.html, /R50\.00/);

  const { c: other } = await customer('snoop@test.local');
  const theirs = await other.page(`/account/purchases/${purchaseId}/receipt`);
  assert.equal(theirs.res.status, 404);
  assert.match(theirs.html, /Receipt not found/);
});

test('payments are refused if the amount, currency, status or payer email is wrong', async () => {
  const { id, c } = await customer('mismatch@test.local');
  const filmId = app.filmId('The Rhythm of Tsonga');   // R50
  const cases = [
    ['REF-LOW', { amountRand: 5, email: 'mismatch@test.local' }],
    ['REF-USD', { amountRand: 50, email: 'mismatch@test.local', currency: 'USD' }],
    ['REF-FAILED', { amountRand: 50, email: 'mismatch@test.local', status: 'failed' }],
    ['REF-OTHER-PAYER', { amountRand: 50, email: 'someone-else@test.local' }]
  ];
  for (const [ref, tx] of cases) {
    app.paystack.pay(ref, tx);
    const { html } = await buy(c, filmId, ref);
    assert.match(html, /Payment could not be verified/, ref);
  }
  const unknown = await buy(c, filmId, 'REF-DOES-NOT-EXIST');
  assert.match(unknown.html, /Payment could not be verified/);
  assert.equal(purchases(id, filmId).length, 0);
});

test('one payment reference can only ever buy one film', async () => {
  const { c } = await customer('replay@test.local');
  app.paystack.pay('REF-REPLAY', { amountRand: 50, email: 'replay@test.local' });
  await buy(c, app.filmId('Ukudweba'), 'REF-REPLAY');
  await app.mail('replay@test.local');
  const { html } = await buy(c, app.filmId('Echoes of the Highveld'), 'REF-REPLAY');
  assert.match(html, /already been used/);
});

test('access lasts 6 months, then the film can be bought again', async () => {
  const { id, c } = await customer('expiry@test.local');
  const filmId = app.filmId('Fulan Fehan Festival');   // R60
  app.db.prepare("INSERT INTO purchases (user_id, content_id, amount_paid, payment_status, transaction_ref, purchase_date) VALUES (?, ?, 60, 'completed', 'REF-OLD', datetime('now', '-6 months', '-1 day'))").run(id, filmId);
  const expired = await c.page(`/film/${filmId}`);
  assert.doesNotMatch(expired.html, /Access until/);
  assert.equal((await c.get(`/film/${filmId}/stream?pt=x`)).status, 403);

  app.db.prepare("UPDATE purchases SET purchase_date = datetime('now', '-6 months', '+1 day') WHERE transaction_ref = 'REF-OLD'").run();
  const active = await c.page(`/film/${filmId}`);
  assert.match(active.html, /Access until/);

  app.db.prepare("UPDATE purchases SET purchase_date = datetime('now', '-7 months') WHERE transaction_ref = 'REF-OLD'").run();
  app.paystack.pay('REF-REBUY', { amountRand: 60, email: 'expiry@test.local' });
  const { location } = await buy(c, filmId, 'REF-REBUY');
  assert.equal(location, `/film/${filmId}`);
  assert.equal(purchases(id, filmId).length, 2);
  await app.mail('expiry@test.local');
});

test('free films need no purchase', async () => {
  const { c } = await customer('free@test.local');
  const filmId = app.filmId('Ubuntu: The Eternal Bond');
  const { html } = await c.page(`/film/${filmId}`);
  assert.doesNotMatch(html, /Buy R/);
  const paid = await c.page(`/film/${app.filmId('Echoes of the Highveld')}`);
  assert.match(paid.html, /Buy R50/, 'a paid film does show the Buy button');
});

test('"Coming soon" films cannot be bought', async () => {
  const { c } = await customer('soon@test.local');
  const filmId = app.filmId('City of Gold');
  app.db.prepare("UPDATE content SET file_url = '', price = 40 WHERE content_id = ?").run(filmId);
  app.paystack.pay('REF-SOON', { amountRand: 40, email: 'soon@test.local' });
  const { html } = await buy(c, filmId, 'REF-SOON');
  assert.match(html, /isn't available yet/);
});

test('18-rated films need a one-time age confirmation before buying or playing', async () => {
  const { id, c } = await customer('teen-check@test.local');
  const filmId = app.filmId('Threads of Venda');
  app.db.prepare("UPDATE content SET age_rating = '18' WHERE content_id = ?").run(filmId);
  app.paystack.pay('REF-18', { amountRand: 50, email: 'teen-check@test.local' });
  const refused = await buy(c, filmId, 'REF-18');
  assert.match(refused.html, /confirm you are 18 or older/);
  assert.equal(purchases(id, filmId).length, 0);

  await c.submit(`/film/${filmId}/confirm-age`, { ageConfirm: 'yes' }, { from: `/film/${filmId}` });
  assert.ok(app.db.prepare('SELECT adult_confirmed_at FROM users WHERE user_id = ?').get(id).adult_confirmed_at);
  const { location } = await buy(c, filmId, 'REF-18');
  assert.equal(location, `/film/${filmId}`);
  await app.mail('teen-check@test.local');
  app.db.prepare('UPDATE content SET age_rating = NULL WHERE content_id = ?').run(filmId);
});

test('one device at a time: pressing Play elsewhere stops the first device', async () => {
  const filmId = app.filmId('Mountain Guardians');   // free
  app.giveFilmAVideo(filmId);
  app.createCustomer({ email: 'two-devices@test.local' });
  const phone = new Client(app); await phone.login('two-devices@test.local');
  const laptop = new Client(app); await laptop.login('two-devices@test.local');
  const tokenA = 'a'.repeat(32), tokenB = 'b'.repeat(32);

  await phone.postJson(`/film/${filmId}/playback/claim`, { playbackToken: tokenA }, { from: `/film/${filmId}` });
  assert.equal((await phone.get(`/film/${filmId}/stream?pt=${tokenA}`)).status, 200);

  await laptop.postJson(`/film/${filmId}/playback/claim`, { playbackToken: tokenB }, { from: `/film/${filmId}` });
  assert.equal((await phone.get(`/film/${filmId}/stream?pt=${tokenA}`)).status, 409, 'first device is refused');
  assert.equal((await laptop.get(`/film/${filmId}/stream?pt=${tokenB}`)).status, 200);

  const beat = await phone.postJson(`/film/${filmId}/track-progress`, { playbackToken: tokenA }, { from: `/film/${filmId}` });
  assert.deepEqual(await beat.json(), { active: false }, 'heartbeat tells the first device to stop');
});

// ---------- Paystack webhook: payments are saved even if the customer never returns ----------
const crypto = require('node:crypto');
async function webhook(event, { signWith = 'sk_test_fake', signature } = {}) {
  const body = JSON.stringify(event);
  const sig = signature || crypto.createHmac('sha512', signWith).update(body).digest('hex');
  return fetch(app.url + '/paystack/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': sig }, body });
}
const charge = (reference, email, filmId, userId) => ({ event: 'charge.success', data: { reference, status: 'success', customer: { email }, metadata: { filmId, userId } } });

test('webhook: a paid customer who never returns to the site still gets the film and receipt', async () => {
  const id = app.createCustomer({ email: 'closed-tab@test.local' });
  const filmId = app.filmId('Echoes of the Highveld');
  app.paystack.pay('REF-WH-1', { amountRand: 50, email: 'closed-tab@test.local' });
  const res = await webhook(charge('REF-WH-1', 'closed-tab@test.local', filmId, id));
  assert.equal(res.status, 200);
  assert.equal(purchases(id, filmId).length, 1);
  assert.match((await app.mail('closed-tab@test.local')).subject, /receipt/);
  // Paystack retrying the same event changes nothing.
  assert.equal((await webhook(charge('REF-WH-1', 'closed-tab@test.local', filmId, id))).status, 200);
  assert.equal(purchases(id, filmId).length, 1);
});

test('webhook: requests without a valid Paystack signature are rejected', async () => {
  const id = app.createCustomer({ email: 'forged@test.local' });
  const filmId = app.filmId('Threads of Venda');
  app.paystack.pay('REF-WH-FORGED', { amountRand: 50, email: 'forged@test.local' });
  assert.equal((await webhook(charge('REF-WH-FORGED', 'forged@test.local', filmId, id), { signWith: 'wrong-key' })).status, 401);
  assert.equal((await webhook(charge('REF-WH-FORGED', 'forged@test.local', filmId, id), { signature: 'abc' })).status, 401);
  assert.equal(purchases(id, filmId).length, 0);
});

test('webhook: a payment that does not verify with Paystack is not recorded', async () => {
  const id = app.createCustomer({ email: 'underpaid@test.local' });
  const filmId = app.filmId('Threads of Venda');   // R50
  app.paystack.pay('REF-WH-LOW', { amountRand: 1, email: 'underpaid@test.local' });
  assert.equal((await webhook(charge('REF-WH-LOW', 'underpaid@test.local', filmId, id))).status, 200);
  assert.equal(purchases(id, filmId).length, 0);
});

test('webhook first, browser second: the customer just sees their film', async () => {
  const id = app.createCustomer({ email: 'both@test.local' });
  const filmId = app.filmId('The Rhythm of Tsonga');
  app.paystack.pay('REF-WH-BOTH', { amountRand: 50, email: 'both@test.local' });
  await webhook(charge('REF-WH-BOTH', 'both@test.local', filmId, id));
  await app.mail('both@test.local');
  const c = new Client(app);
  await c.login('both@test.local');
  const { location, html } = await buy(c, filmId, 'REF-WH-BOTH');
  assert.equal(location, `/film/${filmId}`, html.slice(0, 200));
  assert.equal(purchases(id, filmId).length, 1);
});

test('browser first, webhook second: still only one purchase', async () => {
  const id = app.createCustomer({ email: 'browser-first@test.local' });
  const filmId = app.filmId('Fulan Fehan Festival');   // R60
  app.paystack.pay('REF-WH-B1', { amountRand: 60, email: 'browser-first@test.local' });
  const c = new Client(app);
  await c.login('browser-first@test.local');
  await buy(c, filmId, 'REF-WH-B1');
  assert.equal((await webhook(charge('REF-WH-B1', 'browser-first@test.local', filmId, id))).status, 200);
  assert.equal(purchases(id, filmId).length, 1);
  await app.mail('browser-first@test.local');
});

test("webhook: a payment cannot be credited to a different customer's account", async () => {
  const victim = app.createCustomer({ email: 'victim@test.local' });
  app.createCustomer({ email: 'payer@test.local' });
  const filmId = app.filmId('Ukudweba');
  app.paystack.pay('REF-WH-MISMATCH', { amountRand: 50, email: 'payer@test.local' });
  await webhook(charge('REF-WH-MISMATCH', 'payer@test.local', filmId, victim));
  assert.equal(purchases(victim, filmId).length, 0);
});
