const { db } = require('../db');
const business = require('../config/business');
const { ACCESS_MONTHS } = require('../config/access');
const { PAYSTACK_CURRENCY } = require('../config/paystack');
const { describeRating } = require('../config/ageRatings');

const { TIME_ZONE, parseDbDate } = require('./dates');

function formatMoney(amount) {
  return `R${Number(amount).toFixed(2)}`;
}

function formatDate(date, withTime) {
  return date.toLocaleString('en-ZA', {
    timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
}

// "CA-2026-000042": the year of purchase plus the purchase's own ID, so receipt numbers
// are unique, never reused, and can be traced straight back to the purchases table.
function receiptNumber(purchaseId, purchasedAt) {
  return `CA-${purchasedAt.getUTCFullYear()}-${String(purchaseId).padStart(6, '0')}`;
}

function describePaymentMethod(row) {
  if (row.card_last4) {
    const brand = row.card_brand ? row.card_brand.charAt(0).toUpperCase() + row.card_brand.slice(1) : 'Card';
    return `${brand} ending ${row.card_last4}`;
  }
  if (row.payment_channel) return row.payment_channel.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
  return 'Paid online';
}

// Everything a receipt shows, for one completed purchase. Returns null unless the
// purchase exists, is completed, and (when userId is given) belongs to that user.
function getReceipt(purchaseId, userId) {
  const row = db.prepare(`
    SELECT p.purchase_id, p.user_id, p.amount_paid, p.transaction_ref, p.purchase_date,
           p.payment_channel, p.card_brand, p.card_last4,
           datetime(p.purchase_date, '+${ACCESS_MONTHS} months') AS access_until,
           c.content_id, c.title, c.age_rating, c.content_advisories, cu.name AS culture,
           u.full_name, u.email
    FROM purchases p
    JOIN content c ON c.content_id = p.content_id
    JOIN cultures cu ON cu.culture_id = c.culture_id
    JOIN users u ON u.user_id = p.user_id
    WHERE p.purchase_id = ? AND p.payment_status = 'completed'
  `).get(purchaseId);
  if (!row || (userId !== undefined && row.user_id !== userId)) return null;

  const purchasedAt = parseDbDate(row.purchase_date);
  const total = Number(row.amount_paid);
  const vatIncluded = business.BUSINESS_VAT_NO ? total - total / (1 + business.VAT_RATE) : null;
  const { rating } = describeRating(row.age_rating, row.content_advisories);

  return {
    id: row.purchase_id,
    number: receiptNumber(row.purchase_id, purchasedAt),
    purchasedAt,
    purchasedAtLabel: formatDate(purchasedAt, true),
    accessUntilLabel: formatDate(parseDbDate(row.access_until), false),
    accessMonths: ACCESS_MONTHS,
    customer: { name: row.full_name, email: row.email },
    film: { id: row.content_id, title: row.title, culture: row.culture, rating: rating ? `${rating.code} (${rating.label})` : 'Not yet rated' },
    currency: PAYSTACK_CURRENCY,
    totalLabel: formatMoney(total),
    vatLabel: vatIncluded === null ? null : formatMoney(vatIncluded),
    paymentMethod: describePaymentMethod(row),
    reference: row.transaction_ref,
    business
  };
}

// Every completed purchase for one customer, newest first, for the Account page list.
function listPurchases(userId) {
  return db.prepare(`
    SELECT p.purchase_id, p.amount_paid, p.purchase_date, c.title
    FROM purchases p JOIN content c ON c.content_id = p.content_id
    WHERE p.user_id = ? AND p.payment_status = 'completed'
    ORDER BY p.purchase_date DESC, p.purchase_id DESC
  `).all(userId).map(r => {
    const purchasedAt = parseDbDate(r.purchase_date);
    return {
      id: r.purchase_id,
      number: receiptNumber(r.purchase_id, purchasedAt),
      title: r.title,
      dateLabel: formatDate(purchasedAt, false),
      totalLabel: formatMoney(r.amount_paid)
    };
  });
}

module.exports = { getReceipt, listPurchases };
