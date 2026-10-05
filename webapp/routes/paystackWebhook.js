const crypto = require('crypto');
const { db } = require('../db');
const paystack = require('../config/paystack');
const { verifyPayment, recordPurchase } = require('../utils/purchases');

// Paystack calls this address itself whenever a payment succeeds (set it in the Paystack
// dashboard: Settings → API Keys & Webhooks → Webhook URL = https://<site>/paystack/webhook).
// It makes sure a customer who paid always gets their film, even if their browser closed
// or lost signal before returning to the site. The checkout page records the same payment
// when it does return; whichever is first saves it, and the other does nothing.
//
// Mounted in server.js before the body parsers, with the raw body, because the signature
// is calculated over the exact bytes Paystack sent.
async function paystackWebhook(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const signature = String(req.get('x-paystack-signature') || '');
  const expected = crypto.createHmac('sha512', paystack.PAYSTACK_SECRET_KEY || '').update(raw).digest('hex');
  const valid = paystack.isConfigured && signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return res.status(401).end();

  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).end(); }
  // Paystack retries until it gets a 200, so anything we don't act on is still acknowledged.
  if (!event || event.event !== 'charge.success' || !event.data || !event.data.reference) return res.sendStatus(200);

  const data = event.data;
  const reference = String(data.reference);
  try {
    if (db.prepare('SELECT 1 FROM purchases WHERE transaction_ref = ?').get(reference)) return res.sendStatus(200);

    const meta = data.metadata || {};
    const film = db.prepare('SELECT content_id AS id, title, price, file_url FROM content WHERE content_id = ?').get(Number(meta.filmId));
    const email = String((data.customer && data.customer.email) || '').toLowerCase();
    const userRow = db.prepare("SELECT user_id, full_name, email FROM users WHERE role = 'customer' AND lower(email) = ?").get(email);
    if (!film || !film.file_url || !userRow || (meta.userId && Number(meta.userId) !== Number(userRow.user_id))) {
      console.error(`Paystack webhook: payment ${reference} could not be matched to a customer and film; check it in the Paystack dashboard.`);
      return res.sendStatus(200);
    }

    // Confirm with Paystack directly (amount, currency, payer) before granting access.
    const tx = await verifyPayment(reference, film, userRow.email);
    if (!tx) {
      console.error(`Paystack webhook: payment ${reference} did not verify for film ${film.id}; not recorded.`);
      return res.sendStatus(200);
    }
    const { alreadyRecorded } = recordPurchase({ user: { id: userRow.user_id, fullName: userRow.full_name }, film, reference, tx });
    if (!alreadyRecorded) console.log(`Paystack webhook: recorded payment ${reference} for film ${film.id}.`);
    res.sendStatus(200);
  } catch (err) {
    console.error('Paystack webhook failed:', err.message);
    res.sendStatus(500);   // Paystack will retry later
  }
}

module.exports = paystackWebhook;
