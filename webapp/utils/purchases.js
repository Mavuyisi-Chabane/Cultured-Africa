const { db, logActivity, customerActor, notify } = require('../db');
const paystack = require('../config/paystack');
const { getReceipt } = require('./receipts');
const { sendPurchaseReceipt } = require('../services/email');

// Checks a Paystack transaction really paid for this film: successful, the film's exact
// price in the shop's currency, paid by this customer's email. Returns the verified
// transaction, or null.
async function verifyPayment(reference, film, customerEmail) {
  const result = await paystack.verifyTransaction(reference);
  const tx = result && result.data;
  const ok = result && result.status && tx
    && tx.status === 'success'
    && tx.amount === Math.round(film.price * 100)
    && String(tx.currency || '').toUpperCase() === paystack.PAYSTACK_CURRENCY.toUpperCase()
    && tx.customer && String(tx.customer.email || '').toLowerCase() === String(customerEmail).toLowerCase();
  return ok ? tx : null;
}

// Saves a verified purchase and tells the customer (notification + emailed receipt).
// Used by both the checkout page and the Paystack webhook, whichever arrives first:
// a payment reference is unique in the database, so the second one finds it already
// saved and does nothing. Returns { purchaseId, alreadyRecorded }.
function recordPurchase({ user, film, reference, tx }) {
  const existing = db.prepare('SELECT purchase_id FROM purchases WHERE transaction_ref = ?').get(reference);
  if (existing) return { purchaseId: existing.purchase_id, alreadyRecorded: true };

  const auth = tx.authorization || {};
  let purchaseId;
  try {
    purchaseId = db.prepare(`
      INSERT INTO purchases (user_id, content_id, amount_paid, payment_status, transaction_ref, payment_channel, card_brand, card_last4)
      VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)
    `).run(
      user.id, film.id, film.price, reference,
      tx.channel || null, auth.brand || auth.card_type || null,
      /^\d{4}$/.test(String(auth.last4 || '')) ? String(auth.last4) : null
    ).lastInsertRowid;
  } catch (err) {
    // The checkout page and the webhook saving the same payment at the same moment.
    if (String(err.message).includes('UNIQUE')) {
      const row = db.prepare('SELECT purchase_id FROM purchases WHERE transaction_ref = ?').get(reference);
      return { purchaseId: row && row.purchase_id, alreadyRecorded: true };
    }
    throw err;
  }

  logActivity('Purchase made', film.title, customerActor(user.fullName));
  notify(user.id, 'purchase_confirmation', `Your purchase of "${film.title}" was successful. Enjoy the film! Your receipt has been emailed to you and is also on your Account page.`);
  // The purchase is already saved, so a mail problem must never undo it.
  const receipt = getReceipt(purchaseId, user.id);
  sendPurchaseReceipt(receipt).catch(err => console.error(`Receipt email for purchase ${purchaseId} failed:`, err.message));
  return { purchaseId, alreadyRecorded: false };
}

module.exports = { verifyPayment, recordPurchase };
