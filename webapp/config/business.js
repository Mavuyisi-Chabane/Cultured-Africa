// Seller details printed on customer receipts. The ECT Act expects these on anything
// sold online. Set them in .env once Cultured Africa confirms them (see the pricing
// policy approval document, section A8). A VAT number turns on the VAT line on receipts.
module.exports = {
  BUSINESS_NAME: process.env.BUSINESS_NAME || 'Cultured Africa',
  BUSINESS_REG_NO: process.env.BUSINESS_REG_NO || '',
  BUSINESS_VAT_NO: process.env.BUSINESS_VAT_NO || '',
  BUSINESS_ADDRESS: process.env.BUSINESS_ADDRESS || 'Wits Ehub, The Matrix Shop 3, Wits University, Johannesburg',
  BUSINESS_EMAIL: process.env.BUSINESS_EMAIL || 'info@culturedafrica.co.za',
  VAT_RATE: 0.15
};
