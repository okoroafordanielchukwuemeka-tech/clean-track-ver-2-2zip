/**
 * Lifecycle Email Service — Phase 7.5
 *
 * Sends automated lifecycle emails throughout the customer journey:
 *   - Trial day sequence (day 2, 4, 6, 8, 10, 12, 13, 14)
 *   - Renewal reminders (7d, 3d, 1d before)
 *   - Payment events (successful, failed ×3)
 *   - Cancellation retention
 *
 * Each email type is idempotent — the lifecycle_email_log table enforces
 * (laundry_id, email_type) uniqueness so duplicates are impossible.
 */

import { db } from "@workspace/db";
import {
  laundries,
  lifecycleEmailLog,
  type LifecycleEmailType,
} from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import nodemailer from "nodemailer";
import { log, warn, logError } from "./logger.js";
import { isSmtpConfigured } from "./email-service.js";

const LOG_PREFIX = "[email-lifecycle]";

// ── SMTP helper ────────────────────────────────────────────────────────────────

function getSmtpPass(): string | undefined {
  return process.env.SMTP_PASSWORD || process.env.SMTP_PASS || process.env.RESEND_API_KEY;
}

async function sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!isSmtpConfigured()) {
    warn(`${LOG_PREFIX} SMTP not configured — would send "${subject}" to ${to}`);
    return false;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: parseInt(process.env.SMTP_PORT || "587", 10) === 465,
    auth: { user: process.env.SMTP_USER, pass: getSmtpPass() },
  });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transport.sendMail({ from, to, subject, text, html });
  log(`${LOG_PREFIX} Sent "${subject}" to ${to}`);
  return true;
}

// ── Idempotency guard ──────────────────────────────────────────────────────────

/**
 * Try to reserve the (laundryId, emailType) slot.
 * Returns true if we should send (slot was free), false if already sent.
 */
async function reserveSlot(
  laundryId: number,
  emailType: LifecycleEmailType,
  toEmail: string,
  meta?: Record<string, unknown>
): Promise<boolean> {
  try {
    await db.insert(lifecycleEmailLog).values({
      laundryId,
      emailType,
      toEmail,
      meta: meta ? JSON.stringify(meta) : null,
    });
    return true;
  } catch {
    // unique constraint violation = already sent
    return false;
  }
}

// ── Email header/footer helpers ────────────────────────────────────────────────

const HEADER = `
<div style="background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%);padding:28px 32px 20px;">
  <div style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.5px;">CleanTrack</div>
  <div style="color:#bfdbfe;font-size:13px;margin-top:2px;">Laundry Operations Management</div>
</div>`;

const FOOTER = `
<div style="background:#f1f5f9;padding:14px 32px;text-align:center;">
  <div style="color:#94a3b8;font-size:11px;">
    © ${new Date().getFullYear()} CleanTrack · You're receiving this as part of your trial journey.
    <br>Questions? Email us at <a href="mailto:support@cleantrack.ng" style="color:#64748b;">support@cleantrack.ng</a>
  </div>
</div>`;

function wrap(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
${HEADER}
<div style="padding:28px 32px;">
${body}
</div>
${FOOTER}
</div></body></html>`;
}

function cta(label: string, url: string): string {
  return `<div style="text-align:center;margin:24px 0;">
    <a href="${url}" style="background:#1d4ed8;color:#fff;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
      ${label} →
    </a>
  </div>`;
}

function tip(icon: string, headline: string, body: string): string {
  return `<div style="background:#eff6ff;border-left:4px solid #1d4ed8;border-radius:4px;padding:14px 16px;margin:16px 0;">
    <div style="font-weight:700;color:#1e3a8a;font-size:13px;margin-bottom:4px;">${icon} ${headline}</div>
    <div style="color:#3b5bdb;font-size:13px;line-height:1.5;">${body}</div>
  </div>`;
}

// ── Trial day email templates ──────────────────────────────────────────────────

type EmailContent = { subject: string; html: string; text: string };

export function buildTrialDay2Email(businessName: string, dashboardUrl: string): EmailContent {
  const subject = `💡 Day 2 tip for ${businessName} — going digital from day one`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Running your laundry digitally</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Hi <strong>${businessName}</strong>, here's your Day 2 tip to get the most out of CleanTrack.
    </p>
    ${tip("📱", "Start every day with the dashboard", "Open CleanTrack each morning to see which orders are due today, which payments are pending, and which customers need follow-up. 5 minutes of review saves hours of guesswork.")}
    ${tip("📝", "Create orders at drop-off, not at closing time", "The moment a customer drops clothes, log the order immediately. This prevents disputes and ensures nothing gets lost. Use the mobile view — CleanTrack works on any phone.")}
    ${tip("💰", "Record payments immediately", "Log payments the moment they're made. This keeps your revenue report accurate and makes it easy to see who still owes you.")}
    ${cta("Open my dashboard", dashboardUrl)}
    <p style="color:#64748b;font-size:13px;margin-top:16px;">More tips coming in 2 days. Have questions? Reply to this email.</p>
  `);
  const text = `Day 2 tip for ${businessName}:\n\nStart every day by reviewing your dashboard — which orders are due, which payments are pending.\n\nCreate orders at drop-off, not at the end of the day. Record payments immediately.\n\nLog in: ${dashboardUrl}`;
  return { subject, html, text };
}

export function buildTrialDay4Email(businessName: string, dashboardUrl: string): EmailContent {
  const subject = `🔍 Day 4 tip — how to reduce lost clothes forever`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Reducing lost clothes</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Lost clothes is one of the biggest sources of customer complaints in laundries. Here's how CleanTrack eliminates this.
    </p>
    ${tip("🏷️", "Tag every item on the order", "Use CleanTrack's order items list to log each garment type. When clothes are ready, verify them against the list before calling the customer.")}
    ${tip("📋", "Use batch processing", "Group orders from the same date together. Process them in a batch so nothing gets mixed up with another customer's clothes.")}
    ${tip("✅", "Enable item verification", "In Settings → Operational, turn on 'Require item verification before pickup'. Workers must check off each item before completing a pickup.")}
    ${cta("Set up item verification", `${dashboardUrl}/settings`)}
  `);
  const text = `Day 4 tip: Reducing lost clothes.\n\nTag every item in the order. Use batch processing for same-date orders. Enable item verification in Settings.\n\n${dashboardUrl}`;
  return { subject, html, text };
}

export function buildTrialDay6Email(businessName: string, dashboardUrl: string): EmailContent {
  const subject = `💼 Day 6 tip — keep customers coming back`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Improving customer retention</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Repeat customers are worth 5× more than new ones. Here's how to keep them loyal.
    </p>
    ${tip("📞", "Call customers when clothes are ready", "Use CleanTrack's notifications to automatically alert customers the moment their order is marked 'Ready'. No more customers forgetting their clothes for weeks.")}
    ${tip("💳", "Review outstanding balances weekly", "Go to Customers → sort by Outstanding Balance. Follow up with anyone who hasn't paid. A gentle reminder usually resolves 80% of outstanding amounts.")}
    ${tip("⭐", "Track your best customers", "See which customers bring in the most revenue. Give them priority service to keep them loyal — CleanTrack's customer list shows lifetime value.")}
    ${cta("View my customers", `${dashboardUrl}/customers`)}
  `);
  const text = `Day 6 tip: Customer retention.\n\nNotify customers immediately when clothes are ready. Review outstanding balances weekly. Track your top customers.\n\n${dashboardUrl}/customers`;
  return { subject, html, text };
}

export function buildTrialDay8Email(businessName: string, dashboardUrl: string): EmailContent {
  const subject = `📲 Day 8 tip — using WhatsApp for your laundry`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Using WhatsApp effectively</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      WhatsApp is the #1 communication channel for Nigerian businesses. CleanTrack connects directly to WhatsApp Business.
    </p>
    ${tip("✅", "Connect your WhatsApp Business account", "Go to Settings → WhatsApp Business and follow the setup guide. Once connected, CleanTrack automatically sends order notifications and reminders.")}
    ${tip("🔔", "Enable automation alerts", "Turn on Order Ready, Payment Reminder, and Pickup Reminder alerts in Settings → Automation. Your customers will receive WhatsApp messages automatically — no manual texting.")}
    ${tip("💬", "Use the Customer Hub", "The Customer Hub lets you see all WhatsApp conversations in one inbox. Respond to customers, resolve issues, and track message history.")}
    ${cta("Connect WhatsApp", `${dashboardUrl}/settings`)}
  `);
  const text = `Day 8 tip: Using WhatsApp.\n\nConnect WhatsApp Business in Settings. Enable automation alerts for orders, payments, and pickups. Use the Customer Hub inbox.\n\n${dashboardUrl}/settings`;
  return { subject, html, text };
}

export function buildTrialDay10Email(businessName: string, dashboardUrl: string): EmailContent {
  const subject = `🔄 Day 10 tip — turning one-time customers into regulars`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Increasing repeat customers</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      The easiest way to grow your laundry revenue is to get existing customers to return more often.
    </p>
    ${tip("📅", "Follow up 2 weeks after pickup", "Most customers need laundry done every 2–3 weeks. Send a WhatsApp reminder 2 weeks after their last pickup. CleanTrack's customer history makes this easy.")}
    ${tip("🎁", "Offer loyalty discounts", "Use CleanTrack's discount system to reward customers who bring clothes frequently. A 10% discount on their 5th visit costs less than acquiring a new customer.")}
    ${tip("👥", "Ask for referrals", "Your happiest customers will refer friends if you ask. Add a referral note to WhatsApp messages using message templates.")}
    ${cta("View customer history", `${dashboardUrl}/customers`)}
  `);
  const text = `Day 10 tip: Repeat customers.\n\nFollow up 2 weeks after pickup. Offer loyalty discounts. Ask for referrals using message templates.\n\n${dashboardUrl}/customers`;
  return { subject, html, text };
}

export function buildTrialDay12Email(businessName: string, dashboardUrl: string): EmailContent {
  const subject = `📊 Day 12 tip — making sense of your reports`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Understanding your reports</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      CleanTrack's analytics show you exactly what's working in your laundry — and what isn't.
    </p>
    ${tip("💹", "Check revenue weekly, not monthly", "Weekly revenue reviews help you spot slow weeks early and react. Go to Dashboard → Revenue to see this week vs last week.")}
    ${tip("🏭", "Track expenses to know your real profit", "Many laundry owners confuse revenue with profit. Use Expenditures to log soap, water, electricity, and staff costs. CleanTrack calculates your actual profit margin.")}
    ${tip("👷", "Monitor worker performance", "The dashboard shows each worker's order completion rate. Recognize top performers and coach those who need support.")}
    ${cta("View my analytics", `${dashboardUrl}/dashboard`)}
    <p style="color:#64748b;font-size:13px;margin-top:16px;">
      Your free trial ends in <strong>2 days</strong>. Choose a plan below to keep your data and access.
    </p>
    ${cta("View plans", `${dashboardUrl}/settings`)}
  `);
  const text = `Day 12 tip: Understanding reports.\n\nReview revenue weekly. Track expenses to know real profit. Monitor worker performance.\n\nYour trial ends in 2 days — choose a plan to keep access: ${dashboardUrl}/settings`;
  return { subject, html, text };
}

export function buildTrialDay13Email(businessName: string, dashboardUrl: string): EmailContent {
  const subject = `⏰ Your CleanTrack trial expires tomorrow — secure your access`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Your trial expires tomorrow</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Hi <strong>${businessName}</strong>, your 14-day trial ends tomorrow.
      Don't lose access to your orders, customers, and data.
    </p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="color:#991b1b;font-weight:600;margin:0 0 8px;">What happens when your trial ends:</p>
      <ul style="color:#7f1d1d;font-size:13px;margin:0;padding-left:20px;line-height:1.8;">
        <li>New orders, workers, and branches will be blocked</li>
        <li>Your existing data is safe — nothing is deleted</li>
        <li>Payment instantly restores full access</li>
      </ul>
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      <strong>Choose the plan that fits your business:</strong>
    </p>
    <ul style="color:#475569;font-size:13px;line-height:2;padding-left:20px;">
      <li><strong>Starter — ₦10,000/month</strong> · 1 branch, 2 workers, 500 orders/mo</li>
      <li><strong>Professional — ₦20,000/month</strong> · 5 branches, unlimited workers, AI marketing</li>
      <li><strong>Enterprise — ₦50,000/month</strong> · Unlimited everything, API access</li>
    </ul>
    ${cta("Choose my plan now", `${dashboardUrl}/settings`)}
    <p style="color:#64748b;font-size:12px;text-align:center;">
      Questions? Reply to this email or WhatsApp us. We'll help you pick the right plan.
    </p>
  `);
  const text = `Hi ${businessName}, your trial expires tomorrow.\n\nChoose a plan at ${dashboardUrl}/settings:\n- Starter: ₦10,000/mo\n- Professional: ₦20,000/mo\n- Enterprise: ₦50,000/mo\n\nYour data is safe — payment instantly restores access.`;
  return { subject, html, text };
}

export function buildTrialDay14ExpiredEmail(businessName: string, dashboardUrl: string): EmailContent {
  const subject = `Your CleanTrack trial has ended — upgrade to restore access`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Your trial has ended</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Hi <strong>${businessName}</strong>, your 14-day trial has ended. Your account is now in a grace period.
    </p>
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="color:#92400e;font-weight:600;margin:0 0 4px;">Don't worry — your data is completely safe.</p>
      <p style="color:#78350f;font-size:13px;margin:0;">All your orders, customers, and history are preserved. Upgrade within 7 days to restore full access.</p>
    </div>
    <p style="color:#475569;font-size:14px;font-weight:600;margin-bottom:8px;">Pick your plan:</p>
    <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:16px;">
      <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
        <span style="font-weight:700;">Starter — ₦10,000/month</span>
        <p style="color:#64748b;font-size:12px;margin:2px 0 0;">1 branch · 2 workers · 500 orders/mo · WhatsApp notifications</p>
      </div>
      <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;background:#eff6ff;">
        <span style="font-weight:700;color:#1d4ed8;">Professional — ₦20,000/month ⭐ Most Popular</span>
        <p style="color:#3b5bdb;font-size:12px;margin:2px 0 0;">5 branches · Unlimited workers · AI marketing · Advanced analytics</p>
      </div>
      <div style="padding:12px 16px;">
        <span style="font-weight:700;">Enterprise — ₦50,000/month</span>
        <p style="color:#64748b;font-size:12px;margin:2px 0 0;">Unlimited everything · API access · AI Business Advisor</p>
      </div>
    </div>
    ${cta("Upgrade now", `${dashboardUrl}/settings`)}
    <p style="color:#64748b;font-size:12px;text-align:center;">Need help choosing? Reply to this email — we respond within 1 hour.</p>
  `);
  const text = `Hi ${businessName}, your trial has ended. Your data is safe.\n\nUpgrade at ${dashboardUrl}/settings:\n- Starter: ₦10,000/mo\n- Professional: ₦20,000/mo\n- Enterprise: ₦50,000/mo\n\nWe'll restore full access within 24 hours of payment.`;
  return { subject, html, text };
}

export function buildRenewalReminderEmail(businessName: string, dashboardUrl: string, daysLeft: number, renewsAt: Date): EmailContent {
  const dateStr = renewsAt.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
  const subject = `📅 Your CleanTrack subscription renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Renewal reminder</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;">
      Hi <strong>${businessName}</strong>, your CleanTrack subscription renews on <strong>${dateStr}</strong> — in <strong>${daysLeft} day${daysLeft === 1 ? "" : "s"}</strong>.
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Ensure payment is made before your renewal date to avoid any interruption to your service.
    </p>
    ${cta("Manage my subscription", `${dashboardUrl}/settings`)}
  `);
  const text = `Hi ${businessName}, your subscription renews on ${dateStr} (${daysLeft} days away).\n\nManage your subscription: ${dashboardUrl}/settings`;
  return { subject, html, text };
}

export function buildPaymentSuccessfulEmail(businessName: string, dashboardUrl: string, planName: string, amountNgn: number): EmailContent {
  const subject = `✅ Payment received — CleanTrack ${planName} plan activated`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Payment confirmed!</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin-bottom:16px;">
      Hi <strong>${businessName}</strong>, we've received your payment of <strong>₦${amountNgn.toLocaleString("en-NG")}</strong>.
      Your <strong>${planName}</strong> plan is now active.
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="color:#166534;font-weight:600;margin:0 0 4px;">✓ Account fully activated</p>
      <p style="color:#15803d;font-size:13px;margin:0;">All features and limits for your plan are now available.</p>
    </div>
    ${cta("Go to my dashboard", dashboardUrl)}
    <p style="color:#64748b;font-size:12px;text-align:center;">Thank you for choosing CleanTrack. We're here to help your laundry grow.</p>
  `);
  const text = `Hi ${businessName}, payment of ₦${amountNgn.toLocaleString("en-NG")} confirmed. Your ${planName} plan is active.\n\nDashboard: ${dashboardUrl}`;
  return { subject, html, text };
}

export function buildPaymentFailedEmail(businessName: string, dashboardUrl: string, attempt: 1 | 2 | 3): EmailContent {
  const urgency = attempt === 1 ? "important" : attempt === 2 ? "urgent" : "critical";
  const subject = attempt === 3
    ? `🚨 Final notice — CleanTrack account at risk of suspension`
    : `❌ Payment failed for your CleanTrack subscription`;
  const body = attempt === 1
    ? "We were unable to process your subscription payment. Please ensure your payment is completed to avoid service interruption."
    : attempt === 2
    ? "Your payment is still outstanding. Your account will be suspended soon if payment is not received."
    : "This is your final notice. Your CleanTrack account will be suspended unless payment is made immediately.";
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#dc2626;">Payment failed${attempt > 1 ? ` (attempt ${attempt})` : ""}</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin-bottom:16px;">
      Hi <strong>${businessName}</strong>, ${body}
    </p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="color:#991b1b;font-weight:600;margin:0 0 4px;">What to do</p>
      <p style="color:#7f1d1d;font-size:13px;margin:0;">Contact our support team to arrange payment. Your data is safe until the account is suspended.</p>
    </div>
    ${cta("Contact support to pay", `mailto:support@cleantrack.ng?subject=Payment for ${businessName}`)}
  `);
  const text = `Hi ${businessName}, ${body}\n\nContact support: support@cleantrack.ng\nOr visit: ${dashboardUrl}/settings`;
  return { subject, html, text };
}

export function buildCancellationRetentionEmail(businessName: string, dashboardUrl: string): EmailContent {
  const subject = `We're sorry to see you go — here's what you can do`;
  const html = wrap(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Your subscription has been cancelled</h2>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin-bottom:16px;">
      Hi <strong>${businessName}</strong>, your CleanTrack subscription has been cancelled.
      We're sorry to see you go.
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Your data is preserved and you can reactivate your account at any time. Before you leave, we'd love to understand what could have been better.
    </p>
    ${tip("💡", "Changed your mind?", "You can reactivate your account instantly by choosing a plan. All your data — customers, orders, history — is waiting for you.")}
    ${cta("Reactivate my account", `${dashboardUrl}/settings`)}
    <p style="color:#64748b;font-size:13px;text-align:center;margin-top:16px;">
      To share feedback, reply to this email. We read every response.
    </p>
  `);
  const text = `Hi ${businessName}, your subscription has been cancelled. Your data is preserved.\n\nTo reactivate: ${dashboardUrl}/settings\n\nTo share feedback: reply to this email.`;
  return { subject, html, text };
}

// ── Public send functions ──────────────────────────────────────────────────────

function getDashboardUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}`;
  return "https://app.cleantrack.ng";
}

export async function sendLifecycleEmail(
  laundryId: number,
  ownerEmail: string,
  businessName: string,
  emailType: LifecycleEmailType,
  extra?: Record<string, unknown>
): Promise<boolean> {
  const dashboardUrl = getDashboardUrl();

  const ok = await reserveSlot(laundryId, emailType, ownerEmail, extra);
  if (!ok) {
    log(`${LOG_PREFIX} Already sent ${emailType} to laundry ${laundryId} — skipping`);
    return false;
  }

  try {
    let content: EmailContent;
    switch (emailType) {
      case "trial_day2":   content = buildTrialDay2Email(businessName, dashboardUrl); break;
      case "trial_day4":   content = buildTrialDay4Email(businessName, dashboardUrl); break;
      case "trial_day6":   content = buildTrialDay6Email(businessName, dashboardUrl); break;
      case "trial_day8":   content = buildTrialDay8Email(businessName, dashboardUrl); break;
      case "trial_day10":  content = buildTrialDay10Email(businessName, dashboardUrl); break;
      case "trial_day12":  content = buildTrialDay12Email(businessName, dashboardUrl); break;
      case "trial_day13":  content = buildTrialDay13Email(businessName, dashboardUrl); break;
      case "trial_day14_expired": content = buildTrialDay14ExpiredEmail(businessName, dashboardUrl); break;
      case "renewal_7d":   content = buildRenewalReminderEmail(businessName, dashboardUrl, 7, (extra?.renewsAt as Date) ?? new Date()); break;
      case "renewal_3d":   content = buildRenewalReminderEmail(businessName, dashboardUrl, 3, (extra?.renewsAt as Date) ?? new Date()); break;
      case "renewal_1d":   content = buildRenewalReminderEmail(businessName, dashboardUrl, 1, (extra?.renewsAt as Date) ?? new Date()); break;
      case "payment_successful": content = buildPaymentSuccessfulEmail(businessName, dashboardUrl, (extra?.planName as string) ?? "paid", (extra?.amountNgn as number) ?? 0); break;
      case "payment_failed_immediate": content = buildPaymentFailedEmail(businessName, dashboardUrl, 1); break;
      case "payment_failed_24h":       content = buildPaymentFailedEmail(businessName, dashboardUrl, 2); break;
      case "payment_failed_72h":       content = buildPaymentFailedEmail(businessName, dashboardUrl, 3); break;
      case "cancellation_retention": content = buildCancellationRetentionEmail(businessName, dashboardUrl); break;
      default:
        warn(`${LOG_PREFIX} Unknown email type: ${emailType}`);
        return false;
    }

    await sendMail(ownerEmail, content.subject, content.html, content.text);
    return true;
  } catch (err) {
    // Remove the reserved slot so we can retry next run
    await db.delete(lifecycleEmailLog).where(
      and(
        eq(lifecycleEmailLog.laundryId, laundryId),
        eq(lifecycleEmailLog.emailType, emailType)
      )
    );
    logError(`${LOG_PREFIX} Failed to send ${emailType} to laundry ${laundryId}`, err);
    return false;
  }
}

// ── Trial email scheduler ──────────────────────────────────────────────────────

const TRIAL_DAY_EMAILS: Array<{ day: number; type: LifecycleEmailType }> = [
  { day: 2,  type: "trial_day2" },
  { day: 4,  type: "trial_day4" },
  { day: 6,  type: "trial_day6" },
  { day: 8,  type: "trial_day8" },
  { day: 10, type: "trial_day10" },
  { day: 12, type: "trial_day12" },
  { day: 13, type: "trial_day13" },
  { day: 14, type: "trial_day14_expired" },
];

/**
 * Process all pending trial lifecycle emails.
 * Call this from the daily subscription lifecycle scheduler.
 */
export async function processTrialLifecycleEmails(): Promise<void> {
  const now = new Date();

  // Get all laundries still in trial (or recently expired — catch the day14 email)
  const trialLaundries = await db
    .select({
      id: laundries.id,
      ownerEmail: laundries.ownerEmail,
      businessName: laundries.businessName,
      trialStartedAt: laundries.trialStartedAt,
      subscriptionStatus: laundries.subscriptionStatus,
    })
    .from(laundries)
    .where(
      // Include trial + past_due (to send the expired email on day 14+)
      // We'll check individual days below
      eq(laundries.isActive, true)
    );

  let sent = 0;

  for (const laundry of trialLaundries) {
    if (!laundry.trialStartedAt) continue;
    if (!["trial", "past_due"].includes(laundry.subscriptionStatus)) continue;

    const daysInTrial = Math.floor(
      (now.getTime() - laundry.trialStartedAt.getTime()) / 86_400_000
    );

    for (const { day, type } of TRIAL_DAY_EMAILS) {
      if (daysInTrial >= day) {
        const wasSent = await sendLifecycleEmail(
          laundry.id,
          laundry.ownerEmail,
          laundry.businessName,
          type,
          { daysInTrial, trialDay: day }
        );
        if (wasSent) sent++;
      }
    }
  }

  if (sent > 0) {
    log(`${LOG_PREFIX} Trial lifecycle: sent ${sent} email(s)`);
  }
}

/**
 * Process renewal reminder emails for active subscribers.
 */
export async function processRenewalReminderEmails(): Promise<void> {
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86_400_000);
  const in3d = new Date(now.getTime() + 3 * 86_400_000);
  const in1d = new Date(now.getTime() + 1 * 86_400_000);

  const activeSubscribers = await db
    .select({
      id: laundries.id,
      ownerEmail: laundries.ownerEmail,
      businessName: laundries.businessName,
      subscriptionRenewsAt: laundries.subscriptionRenewsAt,
    })
    .from(laundries)
    .where(
      and(
        eq(laundries.subscriptionStatus, "active"),
        eq(laundries.isActive, true),
        isNull(laundries.trialStartedAt) // Exclude trial accounts
      )
    );

  let sent = 0;

  for (const laundry of activeSubscribers) {
    if (!laundry.subscriptionRenewsAt) continue;
    const renewsAt = laundry.subscriptionRenewsAt;
    const daysUntilRenewal = Math.ceil((renewsAt.getTime() - now.getTime()) / 86_400_000);

    // 7 days before
    if (daysUntilRenewal <= 7 && daysUntilRenewal > 3) {
      const wasSent = await sendLifecycleEmail(laundry.id, laundry.ownerEmail, laundry.businessName, "renewal_7d", { renewsAt });
      if (wasSent) sent++;
    }
    // 3 days before
    if (daysUntilRenewal <= 3 && daysUntilRenewal > 1) {
      const wasSent = await sendLifecycleEmail(laundry.id, laundry.ownerEmail, laundry.businessName, "renewal_3d", { renewsAt });
      if (wasSent) sent++;
    }
    // 1 day before
    if (daysUntilRenewal <= 1 && daysUntilRenewal >= 0) {
      const wasSent = await sendLifecycleEmail(laundry.id, laundry.ownerEmail, laundry.businessName, "renewal_1d", { renewsAt });
      if (wasSent) sent++;
    }
  }

  if (sent > 0) {
    log(`${LOG_PREFIX} Renewal reminders: sent ${sent} email(s)`);
  }
}
