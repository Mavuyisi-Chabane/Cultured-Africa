const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const config = require('../config/email');

// Only used when SMTP isn't configured. Captures the composed email locally so the
// flow can be tested end-to-end without a real mail server. Never written to the
// console/application logs, and gitignored — not something a production deploy uses.
const DEV_INBOX_DIR = path.join(__dirname, '..', 'db', 'dev-inbox');

function getTransporter() {
  if (config.isConfigured) {
    return nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: Number(config.SMTP_PORT),
      secure: Number(config.SMTP_PORT) === 465,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS }
    });
  }
  return nodemailer.createTransport({ jsonTransport: true });
}

async function deliver(mail) {
  const transporter = getTransporter();
  const info = await transporter.sendMail(mail);

  if (!config.isConfigured) {
    fs.mkdirSync(DEV_INBOX_DIR, { recursive: true });
    const safeName = mail.to.replace(/[^a-z0-9.@-]/gi, '_');
    fs.writeFileSync(path.join(DEV_INBOX_DIR, `${safeName}.json`), info.message);
  }
}

async function sendVerificationEmail(user, code) {
  const verifyPageUrl = `${config.APP_BASE_URL}/verify-email`;

  await deliver({
    from: config.MAIL_FROM,
    to: user.email,
    subject: 'Your Cultured Africa verification code',
    text: `Hi ${user.full_name},\n\nYour verification code is: ${code}\n\nEnter it at ${verifyPageUrl} along with your email address. This code expires in 15 minutes.\n\nIf you didn't create this account, you can ignore this email.`,
    html: `<p>Hi ${user.full_name},</p>
<p>Your verification code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:0.3em;color:#1a1a2e;background:#f5f0e8;padding:16px 24px;border-radius:8px;display:inline-block;">${code}</p>
<p>Enter it at <a href="${verifyPageUrl}">${verifyPageUrl}</a> along with your email address. This code expires in <strong>15 minutes</strong>.</p>
<p>If you didn't create this account, you can safely ignore this email.</p>`
  });
}

async function sendPasswordResetEmail(user, rawToken) {
  const resetUrl = `${config.APP_BASE_URL}/reset-password?token=${rawToken}`;

  await deliver({
    from: config.MAIL_FROM,
    to: user.email,
    subject: 'Reset your Cultured Africa password',
    text: `Hi ${user.full_name},\n\nWe received a request to reset the password for your Cultured Africa account. Visit the link below to choose a new password. This link expires in 30 minutes.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password will not be changed.`,
    html: `<p>Hi ${user.full_name},</p>
<p>We received a request to reset the password for your <strong>Cultured Africa</strong> account. Click the button below to choose a new password. This link expires in <strong>30 minutes</strong>.</p>
<p><a href="${resetUrl}" style="display:inline-block;background:#c9a84c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset my password</a></p>
<p>Or paste this link into your browser:<br>${resetUrl}</p>
<p>If you didn't request this, you can safely ignore this email — your password will not be changed.</p>`
  });
}

async function sendAdminInviteEmail(invite, code) {
  const loginUrl = `${config.APP_BASE_URL}/admin/login`;

  await deliver({
    from: config.MAIL_FROM,
    to: invite.email,
    subject: 'You’ve been invited to Cultured Africa Admin Portal',
    text: `Hi ${invite.name},\n\nYou've been invited to join the Cultured Africa Admin Portal. Go to ${loginUrl}, enter your email, and use this verification code to get started: ${code}\n\nThis code expires in 15 minutes. After verifying, you'll set your own password.\n\nIf you weren't expecting this invite, you can ignore this email.`,
    html: `<p>Hi ${invite.name},</p>
<p>You've been invited to join the <strong>Cultured Africa Admin Portal</strong>.</p>
<p>Go to <a href="${loginUrl}">${loginUrl}</a>, enter your email, and use this verification code:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:0.3em;color:#1a1a2e;background:#f5f0e8;padding:16px 24px;border-radius:8px;display:inline-block;">${code}</p>
<p>This code expires in <strong>15 minutes</strong>. After verifying, you'll set your own password.</p>
<p>If you weren't expecting this invite, you can safely ignore this email.</p>`
  });
}

async function sendEmailChangeVerification(target, code) {
  await deliver({
    from: config.MAIL_FROM,
    to: target.email,
    subject: 'Confirm your new Cultured Africa email address',
    text: `Hi ${target.full_name},\n\nWe received a request to change the email address on your Cultured Africa account to this one. Your verification code is: ${code}\n\nEnter it on the Manage Account page to confirm the change. This code expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email — your account email will not change.`,
    html: `<p>Hi ${target.full_name},</p>
<p>We received a request to change the email address on your <strong>Cultured Africa</strong> account to this one. Your verification code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:0.3em;color:#1a1a2e;background:#f5f0e8;padding:16px 24px;border-radius:8px;display:inline-block;">${code}</p>
<p>Enter it on the Manage Account page to confirm the change. This code expires in <strong>15 minutes</strong>.</p>
<p>If you didn't request this, you can safely ignore this email — your account email will not change.</p>`
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Proof of purchase, sent as soon as Paystack confirms the payment. `receipt` comes from
// utils/receipts.js getReceipt(); the same receipt is viewable on the Account page.
async function sendPurchaseReceipt(receipt) {
  const b = receipt.business;
  const receiptUrl = `${config.APP_BASE_URL}/account/purchases/${receipt.id}/receipt`;
  const e = escapeHtml;
  const rows = [
    ['Receipt number', receipt.number],
    ['Date', receipt.purchasedAtLabel],
    ['Film', `${receipt.film.title} (${receipt.film.culture})`],
    ['Access', `Unlimited viewing until ${receipt.accessUntilLabel} (${receipt.accessMonths} months)`],
    ['Paid with', receipt.paymentMethod],
    ['Payment reference', receipt.reference]
  ];
  const seller = [b.BUSINESS_NAME, b.BUSINESS_REG_NO && `Reg. no. ${b.BUSINESS_REG_NO}`, b.BUSINESS_VAT_NO && `VAT no. ${b.BUSINESS_VAT_NO}`, b.BUSINESS_ADDRESS, b.BUSINESS_EMAIL].filter(Boolean);

  await deliver({
    from: config.MAIL_FROM,
    to: receipt.customer.email,
    subject: `Your Cultured Africa receipt ${receipt.number}: ${receipt.film.title}`,
    text: [
      `Hi ${receipt.customer.name},`, '',
      `Thank you for your purchase. This is your receipt.`, '',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      `Total paid: ${receipt.totalLabel} (${receipt.currency})`,
      ...(receipt.vatLabel ? [`Includes VAT (15%): ${receipt.vatLabel}`] : []), '',
      `Watch now or view this receipt any time: ${receiptUrl}`, '',
      seller.join(' · ')
    ].join('\n'),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f1a16;max-width:560px">
<p>Hi ${e(receipt.customer.name)},</p>
<p>Thank you for your purchase. This is your receipt.</p>
<table style="border-collapse:collapse;width:100%;font-size:14px;margin:12px 0">
${rows.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e6ddd2;color:#645a50;width:40%">${e(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #e6ddd2">${e(v)}</td></tr>`).join('')}
<tr><td style="padding:8px;font-weight:bold">Total paid</td><td style="padding:8px;font-weight:bold;font-size:16px">${e(receipt.totalLabel)} <span style="font-weight:normal;color:#645a50;font-size:12px">${e(receipt.currency)}</span></td></tr>
${receipt.vatLabel ? `<tr><td style="padding:4px 8px;color:#645a50">Includes VAT (15%)</td><td style="padding:4px 8px">${e(receipt.vatLabel)}</td></tr>` : ''}
</table>
<p><a href="${receiptUrl}" style="display:inline-block;background:#c9a84c;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">View receipt online</a></p>
<p style="font-size:12px;color:#645a50;margin-top:24px">${seller.map(e).join(' · ')}</p>
</div>`
  });
}

async function sendNewsletterConfirmation(email, token) {
  const confirmUrl = `${config.APP_BASE_URL}/newsletter/confirm?token=${token}`;
  const unsubscribeUrl = `${config.APP_BASE_URL}/newsletter/unsubscribe?token=${token}`;
  await deliver({
    from: config.MAIL_FROM,
    to: email,
    subject: 'Confirm your Cultured Africa newsletter subscription',
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
    text: `Hi,\n\nPlease confirm that you'd like to receive the Cultured Africa newsletter (news about new films and releases):\n\n${confirmUrl}\n\nIf you didn't sign up, ignore this email and you won't be subscribed.\n\nUnsubscribe at any time: ${unsubscribeUrl}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f1a16;max-width:560px">
<p>Hi,</p>
<p>Please confirm that you'd like to receive the <strong>Cultured Africa</strong> newsletter, with news about new films and releases.</p>
<p><a href="${confirmUrl}" style="display:inline-block;background:#c9a84c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Yes, subscribe me</a></p>
<p>If you didn't sign up, just ignore this email and you won't be subscribed.</p>
<p style="font-size:12px;color:#645a50;margin-top:24px">You can <a href="${unsubscribeUrl}" style="color:#645a50">unsubscribe</a> at any time.</p>
</div>`
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendAdminInviteEmail, sendEmailChangeVerification, sendPurchaseReceipt, sendNewsletterConfirmation };
