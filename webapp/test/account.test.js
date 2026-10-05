// The Account page: name, password, email change, newsletter, delete account.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client } = require('./helpers');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.stop(); });

async function customer(email) {
  const id = app.createCustomer({ email, name: 'Ayanda Test' });
  const c = new Client(app);
  await c.login(email);
  return { id, c };
}
const user = id => app.db.prepare('SELECT * FROM users WHERE user_id = ?').get(id);

test('change name: validated, saved and shown straight away', async () => {
  const { id, c } = await customer('name@test.local');
  assert.match((await c.submit('/account/name', { fullName: 'A' }, { from: '/account' })).html, /between 2 and 80/);
  assert.match((await c.submit('/account/name', { fullName: '<b>x</b>' }, { from: '/account' })).html, /cannot contain/);
  const ok = await c.submit('/account/name', { fullName: '  Ayanda   Mthembu ' }, { from: '/account' });
  assert.match(ok.html, /Your name has been updated/);
  assert.equal(user(id).full_name, 'Ayanda Mthembu');
  assert.match((await c.page('/')).html, /Ayanda Mthembu/);
});

test('change password: checks, then logs out other devices and sends a security email', async () => {
  const { id, c } = await customer('pw@test.local');
  const other = new Client(app);
  await other.login('pw@test.local');
  const change = fields => c.submit('/account/password', { currentPassword: 'Passw0rd!', newPassword: 'N3w!Passw0rd', confirmPassword: 'N3w!Passw0rd', ...fields }, { from: '/account' });

  assert.match((await change({ currentPassword: 'wrong' })).html, /current password is incorrect/);
  assert.match((await change({ confirmPassword: 'different' })).html, /do not match/);
  assert.match((await change({ newPassword: 'weakpass', confirmPassword: 'weakpass' })).html, /must include/);
  assert.match((await change({ newPassword: 'Passw0rd!', confirmPassword: 'Passw0rd!' })).html, /must be different/);

  assert.match((await change({})).html, /Your password has been changed/);
  assert.equal((await c.get('/account')).status, 200, 'this device stays logged in');
  assert.equal((await other.get('/account')).status, 302, 'other device logged out');
  assert.equal((await app.mail('pw@test.local')).subject, 'Your Cultured Africa password was changed');
  assert.ok(app.db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND message LIKE 'Your password was changed%'").get(id));
  assert.equal((await new Client(app).login('pw@test.local', 'N3w!Passw0rd')).location, '/');
});

test('repeated wrong current passwords are blocked', async () => {
  const { c } = await customer('pw-limit@test.local');
  let last;
  for (let i = 0; i < 9; i++) last = await c.submit('/account/password', { currentPassword: 'nope', newPassword: 'X', confirmPassword: 'X' }, { from: '/account' });
  assert.match(last.html, /Too many attempts/);
});

test('change email: needs the password and a code sent to the new address', async () => {
  const { id, c } = await customer('old@test.local');
  app.createCustomer({ email: 'in-use@test.local' });
  assert.match((await c.submit('/account/email', { newEmail: 'new@test.local', password: 'wrong' }, { from: '/account' })).html, /Incorrect password/);
  assert.match((await c.submit('/account/email', { newEmail: 'in-use@test.local', password: 'Passw0rd!' }, { from: '/account' })).html, /already in use/);

  await c.submit('/account/email', { newEmail: 'new@test.local', password: 'Passw0rd!' }, { from: '/account' });
  const mail = await app.mail('new@test.local');
  const code = mail.text.match(/\b(\d{6})\b/)[1];
  await c.submit('/account/email/verify', { code }, { from: '/account' });
  assert.equal(user(id).email, 'new@test.local');
});

test('newsletter: subscribe and unsubscribe from the Account page', async () => {
  const { c } = await customer('news@test.local');
  await c.submit('/account/newsletter', { subscribe: 'yes' }, { from: '/account' });
  const row = () => app.db.prepare("SELECT status FROM newsletter_subscribers WHERE email = 'news@test.local'").get();
  assert.equal(row().status, 'confirmed');
  await c.submit('/account/newsletter', { subscribe: 'no' }, { from: '/account' });
  assert.equal(row().status, 'unsubscribed');
});

test('delete account: needs the password, then removes the account and its data', async () => {
  const { id, c } = await customer('delete@test.local');
  app.db.prepare("INSERT INTO newsletter_subscribers (email, status, token) VALUES ('delete@test.local', 'confirmed', 'tok-del')").run();
  assert.match((await c.submit('/account/delete', { password: 'wrong' }, { from: '/account' })).html, /not deleted/);
  await c.submit('/account/delete', { password: 'Passw0rd!' }, { from: '/account' });
  assert.equal(user(id), undefined);
  assert.equal(app.db.prepare("SELECT 1 FROM newsletter_subscribers WHERE email = 'delete@test.local'").get(), undefined);
  assert.equal((await c.get('/account')).status, 302);
});
