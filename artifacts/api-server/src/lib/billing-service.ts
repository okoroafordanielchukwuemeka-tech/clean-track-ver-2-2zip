/**
 * Billing Service — Phase 7.8 Payment Automation & Billing Infrastructure
 *
 * Orchestrates the payment lifecycle on top of the Paystack client
 * (paystack.ts) and the invoice service (invoice-service.ts):
 *   - starting a checkout (new subscription / upgrade / downgrade / reactivate)
 *   - activating a plan after a successful payment (webhook OR manual verify)
 *   - recording failed payments and driving the dunning/grace sequence
 *   - auto-charging saved authorizations on renewal dates
 *
 * IMPORTANT constraint (per Phase 7.8 scope): this file must never change
 * PLAN_FEATURES / PLAN_LIMITS / PLAN_PRICING amounts — it only reads them and
 * automates the *billing* around them. The existing trial/grace-period
 * scheduler (subscription-lifecycle.ts) is untouched; this module adds a
 * parallel, additive renewal-billing scheduler (billing-renewal.ts).
 */
import { db } from "@workspace/db";
import {
  laundries,
  subscriptionLogs,
  subscriptionPayments,
  paymentSubscriptions,
  invoices,
  type SubscriptionStatus,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { getPlanPricing, PAID_PLANS, type PaidPlan } from "./pricing.js";
import { PLAN_DISPLAY_NAMES } from "./entitlements.js";
import {
  initializeTransaction,
  verifyTransaction,
  chargeAuthorization,
  isPaystackConfigured,
  type VerifyTransactionResult,
} from "./paystack.js";
import { createInvoice, markInvoicePaid, markInvoiceFailed } from "./invoice-service.js";
import { sendTransactionalMail } from "./email-service.js";
import {
  buildPaymentSuccessfulEmail,
  buildPaymentFailedEmail,
} from "./email-lifecycle.js";
import { log, logError, warn } from "./logger.js";

const LOG_PREFIX = "[billing-service]";
export type BillingPeriod = "monthly" | "annual";

function getDashboardUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}`;
  return "https://app.cleantrack.ng";
}

export function generateReference(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

export function getPlanAmount(plan: PaidPlan, billingPeriod: BillingPeriod): number {
  const pricing = getPlanPricing(plan);
  if (!pricing) throw new Error(`Unknown plan: ${plan}`);
  return billingPeriod === "annual" ? pricing.price.annual : pricing.price.monthly;
}

function periodMs(billingPeriod: BillingPeriod): number {
  return billingPeriod === "annual" ? 365 * 86_400_000 : 30 * 86_400_000;
}

export type CheckoutPurpose = "new_subscription" | "upgrade" | "downgrade" | "reactivation";

export interface StartCheckoutParams {
  laundryId: number;
  targetPlan: PaidPlan;
  billingPeriod: BillingPeriod;
  purpose: CheckoutPurpose;
}

/**
 * Starts a hosted Paystack checkout for a plan purchase/change/reactivation.
 * Creates a "pending" invoice up front so every checkout attempt — paid or
 * abandoned — is auditable.
 */
export async function startCheckout(params: StartCheckoutParams) {
  if (!isPaystackConfigured()) {
    throw new Error("Payments are not configured. Contact support to complete your upgrade.");
  }

  const [laundry] = await db
    .select({
      businessName: laundries.businessName,
      ownerEmail: laundries.ownerEmail,
      subscriptionTier: laundries.subscriptionTier,
    })
    .from(laundries)
    .where(eq(laundries.id, params.laundryId));
  if (!laundry) throw new Error("Laundry not found");

  const amount = getPlanAmount(params.targetPlan, params.billingPeriod);
  const reference = generateReference("chk");

  const invoiceType =
    params.purpose === "upgrade"
      ? "upgrade"
      : params.purpose === "downgrade"
      ? "downgrade"
      : "new_subscription";

  const invoice = await createInvoice({
    laundryId: params.laundryId,
    type: invoiceType,
    plan: params.targetPlan,
    billingPeriod: params.billingPeriod,
    amountNgn: amount,
    status: "pending",
    paymentMethod: "paystack",
    transactionReference: reference,
  });

  const dashboardUrl = getDashboardUrl();

  const { authorizationUrl } = await initializeTransaction({
    email: laundry.ownerEmail,
    amountNgn: amount,
    reference,
    callbackUrl: `${dashboardUrl}/billing/callback`,
    metadata: {
      laundryId: params.laundryId,
      targetPlan: params.targetPlan,
      billingPeriod: params.billingPeriod,
      purpose: params.purpose,
      invoiceId: invoice.id,
    },
  });

  await db.insert(subscriptionLogs).values({
    laundryId: params.laundryId,
    fromStatus: laundry.subscriptionTier as any,
    toStatus: laundry.subscriptionTier as any,
    fromPlan: laundry.subscriptionTier,
    toPlan: params.targetPlan,
    reason: `checkout_started:${params.purpose}`,
    changedBy: "owner",
    metadata: { reference, amount, billingPeriod: params.billingPeriod },
  });

  return { authorizationUrl, reference, invoiceId: invoice.id };
}

/**
 * Activates a plan after a Paystack transaction verifies as successful.
 * Called from BOTH the webhook handler (charge.success) and the manual
 * verify-on-return endpoint — fully idempotent via the invoice's status.
 */
export async function activatePlanFromPayment(verified: VerifyTransactionResult): Promise<void> {
  const meta = verified.metadata as any;
  const laundryId = Number(meta?.laundryId);
  const invoiceId = Number(meta?.invoiceId);
  const targetPlan = meta?.targetPlan as PaidPlan | undefined;
  const billingPeriod = (meta?.billingPeriod as BillingPeriod) ?? "monthly";
  const purpose = (meta?.purpose as CheckoutPurpose) ?? "new_subscription";

  if (!laundryId || !targetPlan || !PAID_PLANS.includes(targetPlan)) {
    warn(`${LOG_PREFIX} activatePlanFromPayment: missing/invalid metadata`, meta);
    return;
  }

  const [existingInvoice] = invoiceId
    ? await db.select().from(invoices).where(eq(invoices.id, invoiceId))
    : [];

  // Idempotency: if this invoice is already marked paid, do nothing further.
  if (existingInvoice && existingInvoice.status === "paid") {
    log(`${LOG_PREFIX} Invoice ${invoiceId} already paid — skipping duplicate activation`);
    return;
  }

  const [laundry] = await db
    .select({
      subscriptionStatus: laundries.subscriptionStatus,
      subscriptionTier: laundries.subscriptionTier,
      businessName: laundries.businessName,
      ownerEmail: laundries.ownerEmail,
      convertedAt: laundries.convertedAt,
    })
    .from(laundries)
    .where(eq(laundries.id, laundryId));
  if (!laundry) {
    warn(`${LOG_PREFIX} activatePlanFromPayment: laundry ${laundryId} not found`);
    return;
  }

  const now = new Date();
  const renewsAt = new Date(now.getTime() + periodMs(billingPeriod));

  await db
    .update(laundries)
    .set({
      subscriptionTier: targetPlan,
      subscriptionStatus: "active",
      subscriptionRenewsAt: renewsAt,
      convertedAt: laundry.convertedAt ?? now,
      updatedAt: now,
    })
    .where(eq(laundries.id, laundryId));

  const [payment] = await db
    .insert(subscriptionPayments)
    .values({
      laundryId,
      amountNgn: Math.round(verified.amountNgn),
      plan: targetPlan,
      billingPeriod,
      status: "paid",
      paymentMethod: "paystack",
      reference: verified.reference,
      paidAt: now,
    })
    .returning();

  if (existingInvoice) {
    await markInvoicePaid(existingInvoice.id, verified.reference, payment.id);
  }

  // Save/refresh the reusable card authorization for future auto-renewal charges.
  if (verified.authorization?.reusable && verified.authorization.authorizationCode) {
    const auth = verified.authorization;
    const [existingSub] = await db
      .select()
      .from(paymentSubscriptions)
      .where(eq(paymentSubscriptions.laundryId, laundryId));

    if (existingSub) {
      await db
        .update(paymentSubscriptions)
        .set({
          customerCode: verified.customerCode ?? existingSub.customerCode,
          authorizationCode: auth.authorizationCode,
          cardLast4: auth.last4,
          cardBank: auth.bank,
          cardType: auth.cardType,
          reusable: true,
          plan: targetPlan,
          billingPeriod,
          amountNgn: Math.round(verified.amountNgn),
          status: "active",
          nextChargeAt: renewsAt,
          consecutiveFailures: 0,
          lastChargeAt: now,
          lastChargeStatus: "success",
          updatedAt: now,
        })
        .where(eq(paymentSubscriptions.id, existingSub.id));
    } else {
      await db.insert(paymentSubscriptions).values({
        laundryId,
        provider: "paystack",
        customerCode: verified.customerCode,
        authorizationCode: auth.authorizationCode,
        cardLast4: auth.last4,
        cardBank: auth.bank,
        cardType: auth.cardType,
        reusable: true,
        plan: targetPlan,
        billingPeriod,
        amountNgn: Math.round(verified.amountNgn),
        status: "active",
        nextChargeAt: renewsAt,
        lastChargeAt: now,
        lastChargeStatus: "success",
      });
    }
  }

  await db.insert(subscriptionLogs).values({
    laundryId,
    fromStatus: laundry.subscriptionStatus as SubscriptionStatus,
    toStatus: "active",
    fromPlan: laundry.subscriptionTier,
    toPlan: targetPlan,
    reason: `payment_success:${purpose}`,
    changedBy: "paystack_webhook",
    metadata: { reference: verified.reference, amountNgn: verified.amountNgn, billingPeriod },
  });

  const planName = (PLAN_DISPLAY_NAMES as any)[targetPlan] ?? targetPlan;
  const emailContent = buildPaymentSuccessfulEmail(laundry.businessName, getDashboardUrl(), planName, verified.amountNgn);
  sendTransactionalMail({ to: laundry.ownerEmail, subject: emailContent.subject, html: emailContent.html, text: emailContent.text }).catch(
    (err) => logError(`${LOG_PREFIX} Failed to send payment_successful email`, err)
  );

  log(`${LOG_PREFIX} Activated ${targetPlan} for laundry ${laundryId} via ${purpose} (ref ${verified.reference})`);
}

/**
 * Records a failed payment attempt: marks the invoice failed, moves the
 * account into past_due (grace) if it was active, tracks the dunning
 * attempt count, and sends the appropriate escalation email.
 */
export async function recordFailedPayment(params: {
  laundryId: number;
  invoiceId?: number;
  reference: string;
  reason: string;
}): Promise<void> {
  const [laundry] = await db
    .select({
      subscriptionStatus: laundries.subscriptionStatus,
      subscriptionTier: laundries.subscriptionTier,
      businessName: laundries.businessName,
      ownerEmail: laundries.ownerEmail,
    })
    .from(laundries)
    .where(eq(laundries.id, params.laundryId));
  if (!laundry) return;

  if (params.invoiceId) {
    await markInvoiceFailed(params.invoiceId);
  }

  const [sub] = await db
    .select()
    .from(paymentSubscriptions)
    .where(eq(paymentSubscriptions.laundryId, params.laundryId));

  const attempts = (sub?.consecutiveFailures ?? 0) + 1;

  if (sub) {
    await db
      .update(paymentSubscriptions)
      .set({
        status: "attention",
        consecutiveFailures: attempts,
        lastChargeAt: new Date(),
        lastChargeStatus: "failed",
        updatedAt: new Date(),
      })
      .where(eq(paymentSubscriptions.id, sub.id));
  }

  // Move an active subscription into grace (past_due) on first failure — mirrors
  // the trial-expiry grace period already used by subscription-lifecycle.ts.
  if (laundry.subscriptionStatus === "active") {
    const graceDeadline = new Date(Date.now() + 7 * 86_400_000);
    await db
      .update(laundries)
      .set({ subscriptionStatus: "past_due", subscriptionRenewsAt: graceDeadline, updatedAt: new Date() })
      .where(eq(laundries.id, params.laundryId));

    await db.insert(subscriptionLogs).values({
      laundryId: params.laundryId,
      fromStatus: "active",
      toStatus: "past_due",
      fromPlan: laundry.subscriptionTier,
      toPlan: laundry.subscriptionTier,
      reason: `payment_failed:${params.reason}`,
      changedBy: "paystack_webhook",
      metadata: { reference: params.reference, attempt: attempts, graceDeadline: graceDeadline.toISOString() },
    });
  } else {
    await db.insert(subscriptionLogs).values({
      laundryId: params.laundryId,
      fromStatus: laundry.subscriptionStatus as SubscriptionStatus,
      toStatus: laundry.subscriptionStatus as SubscriptionStatus,
      fromPlan: laundry.subscriptionTier,
      toPlan: laundry.subscriptionTier,
      reason: `payment_failed:${params.reason}`,
      changedBy: "paystack_webhook",
      metadata: { reference: params.reference, attempt: attempts },
    });
  }

  const escalation = attempts >= 3 ? 3 : attempts === 2 ? 2 : 1;
  const emailContent = buildPaymentFailedEmail(laundry.businessName, getDashboardUrl(), escalation as 1 | 2 | 3);
  sendTransactionalMail({ to: laundry.ownerEmail, subject: emailContent.subject, html: emailContent.html, text: emailContent.text }).catch(
    (err) => logError(`${LOG_PREFIX} Failed to send payment_failed email`, err)
  );

  log(`${LOG_PREFIX} Recorded failed payment for laundry ${params.laundryId} (attempt ${attempts}, ref ${params.reference})`);
}

/**
 * Auto-charges a saved authorization for renewal. Called by the renewal
 * scheduler (billing-renewal.ts) for subscriptions whose nextChargeAt has
 * arrived. Creates a "renewal" invoice for every attempt (paid or failed).
 */
export async function chargeRenewal(sub: typeof paymentSubscriptions.$inferSelect): Promise<void> {
  const [laundry] = await db
    .select({ ownerEmail: laundries.ownerEmail, subscriptionStatus: laundries.subscriptionStatus })
    .from(laundries)
    .where(eq(laundries.id, sub.laundryId));
  if (!laundry) return;

  if (sub.status === "cancelled" || sub.status === "non_renewing") return;
  if (!sub.authorizationCode) return;

  const reference = generateReference("ren");
  const invoice = await createInvoice({
    laundryId: sub.laundryId,
    type: "renewal",
    plan: sub.plan,
    billingPeriod: sub.billingPeriod,
    amountNgn: sub.amountNgn,
    status: "pending",
    paymentMethod: "paystack",
    transactionReference: reference,
  });

  try {
    const result = await chargeAuthorization({
      email: laundry.ownerEmail,
      amountNgn: sub.amountNgn,
      authorizationCode: sub.authorizationCode,
      reference,
      metadata: {
        laundryId: sub.laundryId,
        targetPlan: sub.plan,
        billingPeriod: sub.billingPeriod,
        purpose: "renewal",
        invoiceId: invoice.id,
      },
    });

    if (result.status === "success") {
      await activatePlanFromPayment(result);
    } else {
      await recordFailedPayment({
        laundryId: sub.laundryId,
        invoiceId: invoice.id,
        reference,
        reason: result.gatewayResponse || "declined",
      });
    }
  } catch (err) {
    logError(`${LOG_PREFIX} Renewal charge failed for laundry ${sub.laundryId}`, err);
    await recordFailedPayment({
      laundryId: sub.laundryId,
      invoiceId: invoice.id,
      reference,
      reason: "gateway_error",
    });
  }
}

/**
 * Manual verify-by-reference — used by the browser return-from-checkout page
 * as a fallback in case the webhook hasn't arrived yet. Safe to call
 * repeatedly; activation is idempotent.
 */
export async function verifyAndActivate(reference: string): Promise<{ status: string; plan?: string }> {
  const verified = await verifyTransaction(reference);
  if (verified.status === "success") {
    await activatePlanFromPayment(verified);
    return { status: "success", plan: (verified.metadata as any)?.targetPlan };
  }
  if (verified.status === "failed" || verified.status === "abandoned") {
    const meta = verified.metadata as any;
    if (meta?.laundryId && meta?.invoiceId) {
      await recordFailedPayment({
        laundryId: Number(meta.laundryId),
        invoiceId: Number(meta.invoiceId),
        reference,
        reason: verified.gatewayResponse || verified.status,
      });
    }
  }
  return { status: verified.status };
}
