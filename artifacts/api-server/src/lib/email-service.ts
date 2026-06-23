/**
 * Phase B — Email Service
 *
 * Sends transactional emails using Nodemailer over configurable SMTP.
 *
 * Required env vars (set as Replit Secrets):
 *   SMTP_HOST     — e.g. smtp.gmail.com
 *   SMTP_PORT     — e.g. 587
 *   SMTP_USER     — your SMTP username / email address
 *   SMTP_PASS     — your SMTP password or app password
 *   SMTP_FROM     — display name + address, e.g. "CleanTrack <no-reply@yourdomain.com>"
 *
 * When SMTP is not configured, the reset URL is logged to the console
 * (development fallback only). In production, always configure SMTP.
 */

import nodemailer from "nodemailer";
import { logError, log, warn } from "./logger.js";

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function getSmtpPass(): string | undefined {
  // Support Resend integration: RESEND_API_KEY doubles as the SMTP password
  return process.env.SMTP_PASSWORD || process.env.SMTP_PASS || process.env.RESEND_API_KEY;
}

function isSmtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    getSmtpPass()
  );
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: parseInt(process.env.SMTP_PORT || "587", 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: getSmtpPass(),
    },
  });
}

async function sendMail(options: MailOptions): Promise<void> {
  if (!isSmtpConfigured()) {
    warn("[email-service] SMTP not configured — email not sent.", {
      to: options.to,
      subject: options.subject,
    });
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transport = createTransport();

  try {
    await transport.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    log("[email-service] Email sent", { to: options.to, subject: options.subject });
  } catch (err) {
    logError("[email-service] Failed to send email", err, { to: options.to });
    throw new Error("Email delivery failed. Please try again later.");
  }
}

export async function sendPasswordResetEmail(
  to: string,
  businessName: string,
  resetUrl: string
): Promise<void> {
  if (!isSmtpConfigured()) {
    warn(
      "[email-service] SMTP not configured. Password reset URL (dev only):",
      { resetUrl }
    );
    console.warn(`\n  [DEV] Password reset URL for ${to}:\n  ${resetUrl}\n`);
    return;
  }

  const subject = "Reset your CleanTrack password";
  const text = `
Hello ${businessName},

You requested a password reset for your CleanTrack account.

Click the link below to reset your password. This link expires in 1 hour.

${resetUrl}

If you did not request this, you can safely ignore this email.
Your password will not change until you click the link above and create a new one.

— The CleanTrack Team
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1e293b;">
  <h2 style="color:#1d4ed8;margin-bottom:8px;">Reset your password</h2>
  <p>Hello <strong>${businessName}</strong>,</p>
  <p>You requested a password reset for your CleanTrack account.</p>
  <p>Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
  <p style="margin:24px 0;">
    <a href="${resetUrl}"
       style="background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
      Reset Password
    </a>
  </p>
  <p style="font-size:13px;color:#64748b;">
    Or copy this link: <a href="${resetUrl}" style="color:#1d4ed8;">${resetUrl}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
  <p style="font-size:12px;color:#94a3b8;">
    If you did not request this reset, you can safely ignore this email.
    Your password will not change.
  </p>
</body>
</html>
`;

  await sendMail({ to, subject, html, text });
}

export { isSmtpConfigured };
