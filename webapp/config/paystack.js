const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY || 'ZAR';

const isConfigured = Boolean(PAYSTACK_PUBLIC_KEY && PAYSTACK_SECRET_KEY);

async function verifyTransaction(reference) {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
  });
  const data = await response.json();
  return data;
}

module.exports = {
  PAYSTACK_PUBLIC_KEY,
  PAYSTACK_CURRENCY,
  isConfigured,
  verifyTransaction
};
