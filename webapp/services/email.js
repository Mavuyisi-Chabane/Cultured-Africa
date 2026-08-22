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

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
