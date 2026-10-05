// Public pages: newsletter double opt-in, Help, Contact, policies, add to home screen.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client } = require('./helpers');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app.stop(); });

test('newsletter: double opt-in, then one-click unsubscribe', async () => {
  const c = new Client(app);
  await c.submit('/newsletter', { email: 'fan@test.local' }, { from: '/' });
  const row = () => app.db.prepare("SELECT * FROM newsletter_subscribers WHERE email = 'fan@test.local'").get();
  assert.equal(row().status, 'pending', 'not subscribed until confirmed');

  const mail = await app.mail('fan@test.local');
  assert.equal(mail.subject, 'Confirm your Cultured Africa newsletter subscription');
  const confirm = mail.text.match(/(http\S+\/newsletter\/confirm\?token=\S+)/)[1];
  await c.get(new URL(confirm).pathname + new URL(confirm).search);
  assert.equal(row().status, 'confirmed');

  await c.get(`/newsletter/unsubscribe?token=${row().token}`);
  assert.equal(row().status, 'unsubscribed');
});

test('policy, privacy, help and contact pages are public', async () => {
  for (const p of ['/purchase-terms', '/privacy', '/help', '/contact', '/about']) {
    assert.equal((await new Client(app).get(p)).status, 200, p);
  }
});

test('Help shows the same refund and access figures as the policy settings', async () => {
  const terms = require('../config/purchaseTerms');
  const { ACCESS_MONTHS } = require('../config/access');
  const { html } = await new Client(app).page('/help');
  assert.match(html, new RegExp(`within ${terms.REFUND_DAYS} days`));
  assert.match(html, new RegExp(`${ACCESS_MONTHS} months`));
});

test('Contact: validates, emails Cultured Africa with the customer as reply address', async () => {
  const c = new Client(app);
  const send = fields => c.submit('/contact', { name: 'Lerato K', email: 'lerato@test.local', topic: 'Billing or refunds', message: 'Receipt CA-2026-000091: charged twice.', ...fields }, { from: '/contact' });
  assert.match((await send({ email: 'bad' })).html, /valid email/);
  assert.match((await send({ topic: 'Nonsense' })).html, /choose what your message is about/);
  assert.match((await send({ message: 'short' })).html, /at least 10 characters/);

  assert.match((await send({ website: 'http://spam.example' })).html, /Message sent/, 'spam trap pretends to succeed');
  assert.equal(await app.mail('info@culturedafrica.co.za', 300), null, '...but sends nothing');

  assert.match((await send({ name: 'Lerato <i>K</i>' })).html, /Message sent/);
  const mail = await app.mail('info@culturedafrica.co.za');
  assert.match(mail.subject, /^Website message: Billing or refunds/);
  assert.match(JSON.stringify(mail.replyTo || mail.headers), /lerato@test\.local/);
  assert.doesNotMatch(mail.html, /<i>K<\/i>/, 'customer text is escaped in the email');
});

test('every email uses the branded layout with the logo attached', async () => {
  await new Client(app).submit('/newsletter', { email: 'brand@test.local' }, { from: '/' });
  const mail = await app.mail('brand@test.local');
  assert.match(mail.html, /cid:logo@culturedafrica/);
  assert.equal(mail.attachments[0].cid, 'logo@culturedafrica');
  assert.match(mail.text, /Cultured Africa · /, 'plain-text version has the footer');
});

test('add to home screen: manifest, icons, service worker and offline page', async () => {
  const g = new Client(app);
  const res = await g.get('/manifest.webmanifest');
  assert.match(res.headers.get('content-type'), /manifest\+json/);
  const manifest = await res.json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) assert.equal((await g.get(icon.src)).status, 200, icon.src);
  const sw = await g.get('/sw.js');
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  const offline = await fetch(app.url + '/offline');
  assert.equal(offline.status, 200);
  assert.equal(offline.headers.getSetCookie().length, 0, 'no session created');
});

test('the built stylesheet is served and pages no longer load the Tailwind CDN', async () => {
  const { html } = await new Client(app).page('/films');
  const href = html.match(/href="(\/css\/app\.css\?v=[^"]+)"/)[1];
  const css = await new Client(app).get(href);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('cache-control'), /max-age=2592000/);
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
});
