const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY || 'ZAR';
// Overridable only so the automated tests can point it at a fake Paystack.
const PAYSTACK_API_BASE = process.env.PAYSTACK_API_BASE || 'https://api.paystack.co';

const isConfigured = Boolean(PAYSTACK_PUBLIC_KEY && PAYSTACK_SECRET_KEY);

async function verifyTransaction(reference) {
  const response = await fetch(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
  });
  const data = await response.json();
  return data;
}

module.exports = {
  PAYSTACK_PUBLIC_KEY,
  PAYSTACK_SECRET_KEY,   // server-side only: verifying payments and webhook signatures
  PAYSTACK_CURRENCY,
  isConfigured,
  verifyTransaction
};
