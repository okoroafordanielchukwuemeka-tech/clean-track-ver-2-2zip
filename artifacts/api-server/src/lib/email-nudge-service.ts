/**
 * Email Nudge Service
 *
 * Sends personalized stuck-user nudge emails with open + click tracking.
 * Called by nudge-engine.ts — does NOT import from nudge-engine.ts (avoids circular dep).
 */

import nodemailer from "nodemailer";
import { logError, log, warn } from "./logger.js";

export type StuckStage =
  | "no_branch"
  | "no_services"
  | "no_customer"
  | "no_order"
  | "no_completion";

export type NudgeType = "24h" | "48h" | "7d";

interface StageCopy {
  subject: string;
  headline: string;
  body: string;
  action: string;
  path: string;
  tip: string;
}

const STAGE_COPY: Record<StuckStage, StageCopy> = {
  no_branch: {
    subject: "One step to finish setting up CleanTrack",
    headline: "Your workspace needs a branch",
    body: "You signed up but haven't created a branch yet. A branch represents your laundry location — it's the first step to organising your operations, assigning workers, and tracking revenue by location.",
    action: "Create Your Branch",
    path: "/settings",
    tip: "Most businesses set up their first branch in under 2 minutes.",
  },
  no_services: {
    subject: "Add your services to start taking orders",
    headline: "Your setup is almost complete",
    body: "You have a branch, but haven't added your laundry services yet. Services are what you charge customers for — shirts, trousers, dry cleaning, and more. Without services, you cannot create orders.",
    action: "Add Services",
    path: "/services",
    tip: "You can always edit prices later. Start with your 3 most common services.",
  },
  no_customer: {
    subject: "Add your first customer — it takes 30 seconds",
    headline: "You're ready to add customers",
    body: "Your branch and services are set up. The next step is adding your first customer. CleanTrack tracks their order history, outstanding balance, and pickup status automatically — no spreadsheet needed.",
    action: "Add First Customer",
    path: "/customers",
    tip: "You only need a name and phone number to get started.",
  },
  no_order: {
    subject: "Your workspace is ready. Create your first order.",
    headline: "Everything is set up. Try creating an order.",
    body: "You have a branch, services, and a customer — you're fully set up. Creating your first order takes under a minute. Once you do, CleanTrack starts tracking revenue and outstanding balances automatically.",
    action: "Create First Order",
    path: "/orders/new",
    tip: "Your first order unlocks revenue tracking, analytics, and financial reports.",
  },
  no_completion: {
    subject: "Complete your first order to unlock full reporting",
    headline: "Your first order is waiting to be completed",
    body: "You've created an order but haven't marked it as completed yet. Once you complete an order after pickup, CleanTrack unlocks revenue tracking, customer history, and financial reports.",
    action: "View My Orders",
    path: "/orders",
    tip: "Mark an order complete when the customer picks up their laundry.",
  },
};

const NUDGE_TYPE_CONTEXT: Record<NudgeType, string> = {
  "24h": "You signed up yesterday and we noticed you haven't finished setting up yet.",
  "48h": "It's been a couple of days since you signed up. We'd love to help you get started.",
  "7d": "A week has passed since you joined CleanTrack. Your workspace is waiting for you.",
};

export interface SendNudgeEmailOptions {
  to: string;
  businessName: string;
  stuckStage: StuckStage;
  nudgeType: NudgeType;
  nudgeLogId: number;
  trackingToken: string;
  baseUrl: string;
}

function getSmtpPass(): string | undefined {
  return process.env.SMTP_PASSWORD || process.env.SMTP_PASS || process.env.RESEND_API_KEY;
}

function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && getSmtpPass());
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

export async function sendNudgeEmail(opts: SendNudgeEmailOptions): Promise<void> {
  const { to, businessName, stuckStage, nudgeType, nudgeLogId, trackingToken, baseUrl } = opts;

  if (!isSmtpConfigured()) {
    warn("[email-nudge] SMTP not configured — nudge email not sent.", { to, stuckStage, nudgeType });
    return;
  }

  const copy = STAGE_COPY[stuckStage];
  if (!copy) {
    warn("[email-nudge] Unknown stuck stage — skipping.", { stuckStage });
    return;
  }

  const context = NUDGE_TYPE_CONTEXT[nudgeType] ?? "";
  const trackBase = `${baseUrl}/api/auth/nudge-track`;
  const pixelUrl = `${trackBase}?e=opened&nlid=${nudgeLogId}&t=${trackingToken}`;
  const actionUrl = `${baseUrl}${copy.path}`;
  const trackedActionUrl = `${trackBase}?e=clicked&nlid=${nudgeLogId}&t=${trackingToken}&url=${encodeURIComponent(actionUrl)}`;

  const subject = copy.subject;

  const text = `
Hi ${businessName},

${context}

${copy.headline}

${copy.body}

${copy.tip}

${copy.action}: ${actionUrl}

If you need help getting started, just reply to this email.

— The CleanTrack Team

---
You're receiving this because you signed up for CleanTrack.
`.trim();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:32px auto 48px;padding:0 16px;">

    <!-- Card -->
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);padding:28px 32px 24px;">
        <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">CleanTrack</div>
        <div style="color:#bfdbfe;font-size:13px;margin-top:3px;">Laundry Operations Management</div>
      </div>

      <!-- Body -->
      <div style="padding:32px 32px 24px;">

        <!-- Context line -->
        <p style="margin:0 0 20px;font-size:13px;color:#64748b;line-height:1.5;">${context}</p>

        <!-- Headline -->
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0f172a;line-height:1.3;">${copy.headline}</h1>

        <!-- Body text -->
        <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.65;">${copy.body}</p>

        <!-- Tip callout -->
        <div style="background:#f0f9ff;border-left:3px solid #3b82f6;border-radius:0 8px 8px 0;padding:12px 16px;margin:0 0 28px;">
          <p style="margin:0;font-size:13px;color:#0369a1;line-height:1.5;">
            <strong>💡 Tip:</strong> ${copy.tip}
          </p>
        </div>

        <!-- CTA Button -->
        <div style="text-align:center;margin:0 0 28px;">
          <a href="${trackedActionUrl}"
             style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:600;
                    text-decoration:none;padding:14px 32px;border-radius:8px;
                    box-shadow:0 1px 3px rgba(37,99,235,0.3);">
            ${copy.action} →
          </a>
        </div>

        <!-- Divider -->
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;">

        <!-- Sign-off -->
        <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">
          Need help? Just reply to this email — we're happy to assist.
        </p>
        <p style="margin:8px 0 0;font-size:14px;color:#64748b;">
          — The CleanTrack Team
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;">
        <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6;">
          You're receiving this because you signed up for CleanTrack.<br>
          To stop receiving these setup reminders, reply with "unsubscribe" in the subject.
        </p>
      </div>
    </div>

    <!-- Open tracking pixel (invisible) -->
    <img src="${pixelUrl}" width="1" height="1" style="display:block;width:1px;height:1px;opacity:0;" alt="" />
  </div>
</body>
</html>`;

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transport = createTransport();

  try {
    await transport.sendMail({ from, to, subject, text, html });
    log("[email-nudge] Nudge email sent", { to, stuckStage, nudgeType });
  } catch (err) {
    logError("[email-nudge] Failed to send nudge email", err, { to, stuckStage });
    throw new Error("Nudge email delivery failed");
  }
}
