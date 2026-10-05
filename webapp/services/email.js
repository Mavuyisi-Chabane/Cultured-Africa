const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const config = require('../config/email');
const business = require('../config/business');

// Only used when SMTP isn't configured. Captures the composed email locally so the
// flow can be tested end-to-end without a real mail server. Never written to the
// console/application logs, and gitignored — not something a production deploy uses.
const DEV_INBOX_DIR = process.env.DEV_INBOX_DIR || path.join(__dirname, '..', 'db', 'dev-inbox');

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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
const e = escapeHtml;

// ---------------------------------------------------------------------------------
// One branded layout for every email: logo, heading, content, and a footer with the
// business details and why the person received it. Table-based with inline styles,
// since that's what Gmail, Outlook and phone mail apps reliably display. The logo is
// attached to the email itself (cid:), so it shows without "load remote images".
// ---------------------------------------------------------------------------------
const LOGO_PATH = path.join(__dirname, '..', 'public', 'images', 'brand', 'logo-email.jpg');
const LOGO_CID = 'logo@culturedafrica';
const COLORS = {
  page: '#f4ece3', card: '#ffffff', text: '#3b322b', heading: '#1f1a16', muted: '#7a6d61',
  line: '#eadfd3', accent: '#c2410c', accentSoft: '#fdf3e7', accentBorder: '#f3d9b8'
};
const FONT = "Arial,Helvetica,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const p = html => `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${COLORS.text}">${html}</p>`;
const small = html => `<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:${COLORS.muted}">${html}</p>`;

function button(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr>
<td style="border-radius:10px;background:${COLORS.accent}"><a href="${e(url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">${e(label)}</a></td>
</tr></table>`;
}

function code(value) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px"><tr>
<td style="background:${COLORS.accentSoft};border:1px solid ${COLORS.accentBorder};border-radius:10px;padding:16px 28px;font-family:'Courier New',monospace;font-size:32px;font-weight:bold;letter-spacing:8px;color:${COLORS.heading}">${e(value)}</td>
</tr></table>`;
}

// A link shown in full for people whose mail app hides buttons.
const fallbackLink = url => small(`Button not working? Copy this link into your browser:<br><a href="${e(url)}" style="color:${COLORS.accent};word-break:break-all">${e(url)}</a>`);

function layout({ preheader, heading, body, reason, extraFooter = '' }) {
  const b = business;
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${e(heading)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page}"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${COLORS.card};border-radius:16px;overflow:hidden">
    <tr><td style="height:6px;background:${COLORS.accent};background-image:linear-gradient(90deg,#fb6b10,#fcaa13);font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td align="center" style="padding:28px 32px 8px"><a href="${e(config.APP_BASE_URL)}"><img src="cid:${LOGO_CID}" width="160" alt="Cultured Africa" style="display:block;width:160px;max-width:60%;height:auto;border:0"></a></td></tr>
    <tr><td style="padding:16px 32px 8px">
      <h1 style="margin:0 0 20px;font-family:${SERIF};font-size:24px;line-height:1.3;font-weight:bold;color:${COLORS.heading}">${e(heading)}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding:20px 32px 28px;border-top:1px solid ${COLORS.line}">
      ${small(e(reason))}
      ${extraFooter}
      <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${COLORS.muted}">
        <strong style="color:${COLORS.text}">${e(b.BUSINESS_NAME)}</strong> · Celebrating African heritage through film<br>
        ${e(b.BUSINESS_ADDRESS)}<br>
        <a href="mailto:${e(b.BUSINESS_EMAIL)}" style="color:${COLORS.muted}">${e(b.BUSINESS_EMAIL)}</a> · <a href="${e(config.APP_BASE_URL)}/privacy" style="color:${COLORS.muted}">Privacy Policy</a><br>
        © ${year} ${e(b.BUSINESS_NAME)}
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// Plain-text version with the same footer, for mail apps that don't show HTML.
function textVersion(lines, reason) {
  const b = business;
  return [...lines, '', '—', reason, `${b.BUSINESS_NAME} · ${b.BUSINESS_ADDRESS} · ${b.BUSINESS_EMAIL}`].join('\n');
}

function sendBranded({ to, replyTo, subject, preheader, heading, body, text, reason, extraFooter, headers }) {
  return deliver({
    from: config.MAIL_FROM,
    to,
    replyTo,
    subject,
    headers,
    text: textVersion(text, reason),
    html: layout({ preheader, heading, body, reason, extraFooter }),
    attachments: [{ filename: 'cultured-africa.jpg', path: LOGO_PATH, cid: LOGO_CID }]
  });
}

// ---------------------------------------------------------------------------------
// The emails
// ---------------------------------------------------------------------------------
async function sendVerificationEmail(user, verificationCode) {
  const verifyPageUrl = `${config.APP_BASE_URL}/verify-email`;
  await sendBranded({
    to: user.email,
    subject: 'Your Cultured Africa verification code',
    preheader: `Your code is ${verificationCode}. It expires in 15 minutes.`,
    heading: 'Verify your email',
    body: p(`Hi ${e(user.full_name)}, welcome to Cultured Africa. Use this code to verify your email address:`)
      + code(verificationCode)
      + p(`Enter it on the <a href="${e(verifyPageUrl)}" style="color:${COLORS.accent}">verification page</a> along with your email address. The code expires in <strong>15 minutes</strong>.`),
    text: [`Hi ${user.full_name},`, '', `Your verification code is: ${verificationCode}`, '', `Enter it at ${verifyPageUrl} along with your email address. This code expires in 15 minutes.`],
    reason: "You received this because someone created a Cultured Africa account with this email address. If it wasn't you, ignore this email and no account will be activated."
  });
}

async function sendPasswordResetEmail(user, rawToken) {
  const resetUrl = `${config.APP_BASE_URL}/reset-password?token=${rawToken}`;
  await sendBranded({
    to: user.email,
    subject: 'Reset your Cultured Africa password',
    preheader: 'Choose a new password. This link expires in 30 minutes.',
    heading: 'Reset your password',
    body: p(`Hi ${e(user.full_name)}, we received a request to reset the password for your Cultured Africa account. Click the button to choose a new one. The link expires in <strong>30 minutes</strong> and can only be used once.`)
      + button(resetUrl, 'Choose a new password')
      + fallbackLink(resetUrl),
    text: [`Hi ${user.full_name},`, '', 'We received a request to reset the password for your Cultured Africa account. Visit the link below to choose a new password. This link expires in 30 minutes.', '', resetUrl],
    reason: "You received this because a password reset was requested for your account. If it wasn't you, ignore this email; your password will not change."
  });
}

async function sendAdminInviteEmail(invite, verificationCode) {
  const loginUrl = `${config.APP_BASE_URL}/admin/login`;
  await sendBranded({
    to: invite.email,
    subject: 'You’ve been invited to the Cultured Africa Admin Portal',
    preheader: 'Use the code inside to set up your admin account.',
    heading: 'Join the Admin Portal',
    body: p(`Hi ${e(invite.name)}, you've been invited to help manage <strong>Cultured Africa</strong>. Go to the Admin Portal, enter this email address, and use this code to get started:`)
      + code(verificationCode)
      + p('The code expires in <strong>15 minutes</strong>. After verifying, you\'ll set your own password.')
      + button(loginUrl, 'Open the Admin Portal'),
    text: [`Hi ${invite.name},`, '', `You've been invited to join the Cultured Africa Admin Portal. Go to ${loginUrl}, enter your email, and use this verification code to get started: ${verificationCode}`, '', "This code expires in 15 minutes. After verifying, you'll set your own password."],
    reason: "You received this because a Cultured Africa administrator invited this email address. If you weren't expecting it, ignore this email."
  });
}

async function sendEmailChangeVerification(target, verificationCode) {
  await sendBranded({
    to: target.email,
    subject: 'Confirm your new Cultured Africa email address',
    preheader: `Your code is ${verificationCode}. It expires in 15 minutes.`,
    heading: 'Confirm your new email address',
    body: p(`Hi ${e(target.full_name)}, we received a request to change the email address on your Cultured Africa account to this one. Your verification code is:`)
      + code(verificationCode)
      + p('Enter it on the Manage Account page to confirm the change. The code expires in <strong>15 minutes</strong>.'),
    text: [`Hi ${target.full_name},`, '', `We received a request to change the email address on your Cultured Africa account to this one. Your verification code is: ${verificationCode}`, '', 'Enter it on the Manage Account page to confirm the change. This code expires in 15 minutes.'],
    reason: "You received this because someone asked to move a Cultured Africa account to this address. If it wasn't you, ignore this email; nothing will change."
  });
}

// A message from the Contact page, delivered to Cultured Africa's inbox. Replying to
// the email goes straight to the customer (Reply-To).
async function sendContactMessage({ name, email, topic, message, accountEmail }) {
  const b = business;
  const accountLine = accountEmail ? `Sent while logged in as ${accountEmail}.` : 'Sent by a visitor who was not logged in.';
  await sendBranded({
    to: b.BUSINESS_EMAIL,
    replyTo: `"${name.replace(/["\r\n]/g, '')}" <${email}>`,
    subject: `Website message: ${topic} (from ${name})`,
    preheader: message.slice(0, 120),
    heading: 'New message from the website',
    body: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
${[['From', name], ['Email', email], ['Topic', topic]].map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:14px;color:${COLORS.muted};width:25%">${e(k)}</td><td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:14px;color:${COLORS.heading}">${e(v)}</td></tr>`).join('\n')}
</table>`
      + `<div style="background:${COLORS.accentSoft};border:1px solid ${COLORS.accentBorder};border-radius:10px;padding:16px 20px;margin:0 0 20px;font-family:${FONT};font-size:15px;line-height:1.6;color:${COLORS.text};white-space:pre-wrap">${e(message)}</div>`
      + small(`${e(accountLine)} Reply to this email to answer ${e(name)} directly.`),
    text: [`From: ${name} <${email}>`, `Topic: ${topic}`, accountLine, '', message],
    reason: 'Sent from the Contact page on the Cultured Africa website.'
  });
}

// Security alert after a password change from the Account page.
async function sendPasswordChangedEmail(user) {
  const forgotUrl = `${config.APP_BASE_URL}/forgot-password`;
  await sendBranded({
    to: user.email,
    subject: 'Your Cultured Africa password was changed',
    preheader: "If this wasn't you, reset your password now.",
    heading: 'Your password was changed',
    body: p(`Hi ${e(user.full_name)}, the password for your Cultured Africa account was just changed from your Account page. You've been logged out on your other devices.`)
      + p("<strong>If this wasn't you</strong>, reset your password straight away and let us know.")
      + button(forgotUrl, 'Reset my password'),
    text: [`Hi ${user.full_name},`, '', "The password for your Cultured Africa account was just changed from your Account page. You've been logged out on your other devices.", '', `If this wasn't you, reset your password straight away: ${forgotUrl}`],
    reason: 'You received this security alert because the password on your Cultured Africa account was changed. No action is needed if it was you.'
  });
}

// Proof of purchase, sent as soon as Paystack confirms the payment. `receipt` comes from
// utils/receipts.js getReceipt(); the same receipt is viewable on the Account page.
async function sendPurchaseReceipt(receipt) {
  const b = receipt.business;
  const receiptUrl = `${config.APP_BASE_URL}/account/purchases/${receipt.id}/receipt`;
  const filmUrl = `${config.APP_BASE_URL}/film/${receipt.film.id}`;
  const rows = [
    ['Receipt number', receipt.number],
    ['Date', receipt.purchasedAtLabel],
    ['Film', `${receipt.film.title} (${receipt.film.culture})`],
    ['Access', `Unlimited viewing until ${receipt.accessUntilLabel} (${receipt.accessMonths} months)`],
    ['Paid with', receipt.paymentMethod],
    ['Payment reference', receipt.reference]
  ];
  const seller = [b.BUSINESS_NAME, b.BUSINESS_REG_NO && `Reg. no. ${b.BUSINESS_REG_NO}`, b.BUSINESS_VAT_NO && `VAT no. ${b.BUSINESS_VAT_NO}`].filter(Boolean);
  const cell = `padding:10px 0;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:14px;vertical-align:top`;

  await sendBranded({
    to: receipt.customer.email,
    subject: `Your Cultured Africa receipt ${receipt.number}: ${receipt.film.title}`,
    preheader: `${receipt.totalLabel} paid for ${receipt.film.title}. Watch any time until ${receipt.accessUntilLabel}.`,
    heading: 'Thank you for your purchase',
    body: p(`Hi ${e(receipt.customer.name)}, <strong>${e(receipt.film.title)}</strong> is now in your library. This is your receipt.`)
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
${rows.map(([k, v]) => `<tr><td style="${cell};color:${COLORS.muted};width:40%;padding-right:12px">${e(k)}</td><td style="${cell};color:${COLORS.heading}">${e(v)}</td></tr>`).join('\n')}
<tr><td style="padding:14px 12px 4px 0;font-family:${FONT};font-size:15px;font-weight:bold;color:${COLORS.heading}">Total paid</td><td style="padding:14px 0 4px;font-family:${FONT};font-size:18px;font-weight:bold;color:${COLORS.heading}">${e(receipt.totalLabel)} <span style="font-size:12px;font-weight:normal;color:${COLORS.muted}">${e(receipt.currency)}</span></td></tr>
${receipt.vatLabel ? `<tr><td style="padding:2px 12px 0 0;font-family:${FONT};font-size:13px;color:${COLORS.muted}">Includes VAT (15%)</td><td style="padding:2px 0 0;font-family:${FONT};font-size:13px;color:${COLORS.text}">${e(receipt.vatLabel)}</td></tr>` : ''}
</table>`
      + button(filmUrl, 'Watch now')
      + small(`<a href="${e(receiptUrl)}" style="color:${COLORS.accent}">View or print this receipt online</a>. All your receipts are also under Purchases &amp; Receipts on your Account page.`),
    text: [
      `Hi ${receipt.customer.name},`, '',
      'Thank you for your purchase. This is your receipt.', '',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      `Total paid: ${receipt.totalLabel} (${receipt.currency})`,
      ...(receipt.vatLabel ? [`Includes VAT (15%): ${receipt.vatLabel}`] : []), '',
      `Watch now: ${filmUrl}`,
      `View this receipt any time: ${receiptUrl}`,
      ...(seller.length > 1 ? ['', seller.join(' · ')] : [])
    ],
    reason: 'You received this receipt because you bought a film on Cultured Africa. Keep it as your proof of purchase.',
    extraFooter: seller.length > 1 ? small(seller.map(e).join(' · ')) : ''
  });
}

async function sendNewsletterConfirmation(email, token) {
  const confirmUrl = `${config.APP_BASE_URL}/newsletter/confirm?token=${token}`;
  const unsubscribeUrl = `${config.APP_BASE_URL}/newsletter/unsubscribe?token=${token}`;
  await sendBranded({
    to: email,
    subject: 'Confirm your Cultured Africa newsletter subscription',
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
    preheader: 'One click to confirm and you\'ll hear about new films first.',
    heading: 'Confirm your subscription',
    body: p('Hi, please confirm that you\'d like to receive the <strong>Cultured Africa</strong> newsletter, with news about new films and releases.')
      + button(confirmUrl, 'Yes, subscribe me')
      + p("If you didn't sign up, just ignore this email and you won't be subscribed.")
      + fallbackLink(confirmUrl),
    text: ['Hi,', '', "Please confirm that you'd like to receive the Cultured Africa newsletter (news about new films and releases):", '', confirmUrl, '', "If you didn't sign up, ignore this email and you won't be subscribed.", '', `Unsubscribe at any time: ${unsubscribeUrl}`],
    reason: 'You received this because this email address was entered in the newsletter sign-up on the Cultured Africa website.',
    extraFooter: small(`You can <a href="${e(unsubscribeUrl)}" style="color:${COLORS.muted}">unsubscribe</a> at any time.`)
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendAdminInviteEmail, sendEmailChangeVerification, sendPasswordChangedEmail, sendContactMessage, sendPurchaseReceipt, sendNewsletterConfirmation };
