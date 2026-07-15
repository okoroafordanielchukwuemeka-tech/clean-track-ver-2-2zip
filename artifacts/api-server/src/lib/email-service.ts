/**
 * Phase B — Email Service
 *
 * Sends transactional emails using Nodemailer over configurable SMTP.
 *
 * Required env vars (set as Replit Secrets):
 *   SMTP_HOST     — e.g. smtp.resend.com
 *   SMTP_PORT     — e.g. 587
 *   SMTP_USER     — your SMTP username
 *   SMTP_PASS / SMTP_PASSWORD / RESEND_API_KEY — SMTP password or API key
 *   SMTP_FROM     — display name + address, e.g. "CleanTrack <no-reply@yourdomain.com>"
 *
 * When SMTP is not configured, URLs are logged to the console (dev fallback only).
 */

import nodemailer from "nodemailer";
import crypto from "crypto";
import { logError, log, warn } from "./logger.js";

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function getSmtpPass(): string | undefined {
  return process.env.SMTP_PASSWORD || process.env.SMTP_PASS || process.env.RESEND_API_KEY;
}

export function isSmtpConfigured(): boolean {
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

/**
 * Generic transactional send — used by billing-service.ts for payment
 * success/failure/invoice emails, which are keyed by transaction/invoice
 * (not laundry+type like the trial/renewal lifecycle sequence), so they
 * don't go through the lifecycle_email_log one-per-type dedup guard.
 */
export async function sendTransactionalMail(options: MailOptions): Promise<boolean> {
  if (!isSmtpConfigured()) {
    warn("[email-service] SMTP not configured — transactional email not sent.", {
      to: options.to,
      subject: options.subject,
    });
    return false;
  }
  await sendMail(options);
  return true;
}

// ── Email engagement tracking token ──────────────────────────────────────────
// Signs laundryId with JWT_SECRET so tracking endpoints can verify the token
// without storing it — no extra DB table needed.

export function generateEmailTrackingToken(laundryId: number): string {
  const secret = process.env.JWT_SECRET ?? "fallback-secret";
  return crypto
    .createHmac("sha256", secret)
    .update(`email-track:${laundryId}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyEmailTrackingToken(token: string, laundryId: number): boolean {
  const expected = generateEmailTrackingToken(laundryId);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Password Reset Email ──────────────────────────────────────────────────────

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

// ── Welcome Email ─────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(
  to: string,
  businessName: string,
  laundryId: number,
  baseUrl: string
): Promise<void> {
  const loginUrl = `${baseUrl}/`;
  const trackingToken = generateEmailTrackingToken(laundryId);
  const trackBase = `${baseUrl}/api/auth/email-track`;
  const pixelUrl = `${trackBase}?t=${trackingToken}&lid=${laundryId}&e=opened`;
  const trackedLoginUrl = `${trackBase}?t=${trackingToken}&lid=${laundryId}&e=clicked&url=${encodeURIComponent(loginUrl)}`;

  const subject = "Welcome to CleanTrack 🎉 — Let's set up your laundry";

  const text = `
Welcome to CleanTrack, ${businessName}!

Your laundry workspace is ready. Here's how to get started:

Step 1 — Create your first customer
Go to Customers → Add Customer and enter their name and phone number.

Step 2 — Add your laundry services
Go to Services → Add Service to set your pricing for shirts, trousers, dry cleaning, etc.

Step 3 — Create your first order
Go to Orders → New Order, pick the customer, select services, and save.

Step 4 — Record payment
On the order page, tap Record Payment to mark it as paid.

Once you've completed your first order, you're fully set up!

Login to your dashboard: ${loginUrl}

Need help? Reply to this email — we're here for you.

— The CleanTrack Team
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%);padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">CleanTrack</div>
      <div style="color:#bfdbfe;font-size:14px;margin-top:4px;">Laundry Operations Management</div>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">
        Welcome, ${businessName}! 🎉
      </h1>
      <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
        Your CleanTrack workspace is live. Follow these 4 steps to create your first order and see the full power of the system.
      </p>

      <!-- Steps -->
      <div style="background:#f8fafc;border-radius:10px;padding:20px;margin-bottom:24px;">

        <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
          <div style="background:#1d4ed8;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;shrink:0;margin-right:14px;min-width:28px;">1</div>
          <div>
            <div style="font-weight:600;color:#0f172a;font-size:14px;">Create your first customer</div>
            <div style="color:#64748b;font-size:13px;margin-top:2px;">Go to Customers → Add Customer. Enter their name and phone number.</div>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
          <div style="background:#1d4ed8;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;shrink:0;margin-right:14px;min-width:28px;">2</div>
          <div>
            <div style="font-weight:600;color:#0f172a;font-size:14px;">Review your services &amp; pricing</div>
            <div style="color:#64748b;font-size:13px;margin-top:2px;">We've added common laundry services. Go to Services to adjust prices for your business.</div>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
          <div style="background:#1d4ed8;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;shrink:0;margin-right:14px;min-width:28px;">3</div>
          <div>
            <div style="font-weight:600;color:#0f172a;font-size:14px;">Create your first order</div>
            <div style="color:#64748b;font-size:13px;margin-top:2px;">Go to Orders → New Order. Pick the customer, add garments, and confirm.</div>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;">
          <div style="background:#059669;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;shrink:0;margin-right:14px;min-width:28px;">4</div>
          <div>
            <div style="font-weight:600;color:#0f172a;font-size:14px;">Record payment &amp; complete</div>
            <div style="color:#64748b;font-size:13px;margin-top:2px;">On the order, tap Record Payment. Once clothes are collected, mark it Complete.</div>
          </div>
        </div>

      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${trackedLoginUrl}"
           style="background:#1d4ed8;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;letter-spacing:0.2px;">
          Go to My Dashboard →
        </a>
      </div>

      <!-- Why this matters -->
      <div style="background:#eff6ff;border-left:4px solid #1d4ed8;border-radius:4px;padding:14px 16px;margin-bottom:24px;">
        <div style="font-weight:600;color:#1e3a8a;font-size:13px;margin-bottom:4px;">Why completing your first order matters</div>
        <div style="color:#3b5bdb;font-size:13px;line-height:1.5;">
          Once you've processed your first real order, CleanTrack starts tracking revenue, outstanding balances, and customer history automatically — saving you hours of manual bookkeeping every week.
        </div>
      </div>

      <!-- Support -->
      <div style="border-top:1px solid #e2e8f0;padding-top:20px;">
        <div style="color:#64748b;font-size:13px;line-height:1.6;">
          Need help getting started? Reply to this email — our team will personally help you set up.
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f1f5f9;padding:16px 32px;text-align:center;">
      <div style="color:#94a3b8;font-size:12px;">
        © ${new Date().getFullYear()} CleanTrack · You're receiving this because you created a workspace.
      </div>
    </div>
  </div>

  <!-- 1×1 tracking pixel -->
  <img src="${pixelUrl}" width="1" height="1" style="display:none;" alt="" />
</body>
</html>
`;

  if (!isSmtpConfigured()) {
    warn("[email-service] SMTP not configured — welcome email not sent.", { to });
    console.warn(`\n  [DEV] Welcome email would be sent to: ${to}\n`);
    return;
  }

  await sendMail({ to, subject, html, text });
}
