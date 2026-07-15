import { Router } from "express";
import { db } from "@workspace/db";
import { laundries, subscriptionLogs, subscriptionPayments, paymentSubscriptions } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { getEffectivePlanFeatures, getEffectivePlanLimits, PLAN_DISPLAY_NAMES, getEntitlementReport } from "../lib/entitlements.js";
import { computeUsageWithLimits } from "../lib/usage-service.js";
import { getPricingList, MANUAL_PAYMENT_INSTRUCTIONS, PAID_PLANS, type PaidPlan } from "../lib/pricing.js";
import type { SubscriptionStatus } from "@workspace/db/schema";
import { sendLifecycleEmail } from "../lib/email-lifecycle.js";
import { startCheckout, verifyAndActivate } from "../lib/billing-service.js";
import { isPaystackConfigured, getPaystackPublicKey } from "../lib/paystack.js";
import { listInvoices, getInvoice, renderInvoiceHtml } from "../lib/invoice-service.js";

export const subscriptionRouter = Router();

subscriptionRouter.get("/status", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const [laundry] = await db
      .select({
        subscriptionStatus: laundries.subscriptionStatus,
        subscriptionTier: laundries.subscriptionTier,
        trialStartedAt: laundries.trialStartedAt,
        trialEndsAt: laundries.trialEndsAt,
        trialDurationDays: laundries.trialDurationDays,
        convertedAt: laundries.convertedAt,
        subscriptionRenewsAt: laundries.subscriptionRenewsAt,
      })
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    if (!laundry) return res.status(404).json({ error: "Not found" });

    const features = getEffectivePlanFeatures(laundry.subscriptionTier, laundry.subscriptionStatus);
    const rawLimits = getEffectivePlanLimits(laundry.subscriptionTier, laundry.subscriptionStatus);
    const planDisplayName = (PLAN_DISPLAY_NAMES as any)[laundry.subscriptionTier] ?? laundry.subscriptionTier;

    // JSON.stringify(Infinity) → "null", which is indistinguishable from missing data.
    // Normalize: Infinity → null (meaning "unlimited") so clients can reliably detect unlimited plans.
    const limits = {
      maxBranches:       isFinite(rawLimits.maxBranches)       ? rawLimits.maxBranches       : null,
      maxWorkers:        isFinite(rawLimits.maxWorkers)        ? rawLimits.maxWorkers        : null,
      maxOrdersPerMonth: isFinite(rawLimits.maxOrdersPerMonth) ? rawLimits.maxOrdersPerMonth : null,
      maxCustomers:      isFinite(rawLimits.maxCustomers)      ? rawLimits.maxCustomers      : null,
    };

    let trialDaysRemaining: number | null = null;
    if (laundry.subscriptionStatus === "trial" && laundry.trialEndsAt) {
      trialDaysRemaining = Math.max(
        0,
        Math.ceil(
          (new Date(laundry.trialEndsAt).getTime() - Date.now()) / 86_400_000
        )
      );
    }

    let graceDaysRemaining: number | null = null;
    if (laundry.subscriptionStatus === "past_due" && laundry.subscriptionRenewsAt) {
      graceDaysRemaining = Math.max(
        0,
        Math.ceil(
          (new Date(laundry.subscriptionRenewsAt).getTime() - Date.now()) / 86_400_000
        )
      );
    }

    res.json({
      status: laundry.subscriptionStatus,
      plan: laundry.subscriptionTier,
      planDisplayName,
      trialStartedAt: laundry.trialStartedAt,
      trialEndsAt: laundry.trialEndsAt,
      trialDaysRemaining,
      graceDaysRemaining,
      convertedAt: laundry.convertedAt,
      subscriptionRenewsAt: laundry.subscriptionRenewsAt,
      features,
      limits,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch subscription status" });
  }
});

subscriptionRouter.get("/usage", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const [laundry] = await db
      .select({ subscriptionTier: laundries.subscriptionTier, subscriptionStatus: laundries.subscriptionStatus })
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    if (!laundry) return res.status(404).json({ error: "Not found" });

    // During trial, report usage against Enterprise limits so new accounts
    // don't see false "limit reached" warnings.
    const effectiveTier = laundry.subscriptionStatus === "trial" ? "business" : laundry.subscriptionTier;
    const usage = await computeUsageWithLimits(laundryId, effectiveTier);
    res.json(usage);
  } catch {
    res.status(500).json({ error: "Failed to fetch usage" });
  }
});

subscriptionRouter.get("/entitlements", requireOwner, async (_req, res) => {
  try {
    res.json(getEntitlementReport());
  } catch {
    res.status(500).json({ error: "Failed to fetch entitlement report" });
  }
});

/**
 * GET /subscription/pricing
 * Returns all plan pricing configs + manual payment instructions.
 */
subscriptionRouter.get("/pricing", requireOwner, (_req, res) => {
  try {
    res.json({
      plans: getPricingList(),
      paymentInstructions: MANUAL_PAYMENT_INSTRUCTIONS,
      currency: "NGN",
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch pricing" });
  }
});

// NOTE: the unauthenticated equivalent of this endpoint, consumed by the
// pre-signup marketing pricing page, lives at GET /api/subscription/public-pricing
// in routes/index.ts (must be mounted before the requireOwner-gated router below).

/**
 * GET /subscription/history
 * Returns subscription state transition log for this laundry.
 */
subscriptionRouter.get("/history", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const logs = await db
      .select()
      .from(subscriptionLogs)
      .where(eq(subscriptionLogs.laundryId, laundryId))
      .orderBy(desc(subscriptionLogs.createdAt))
      .limit(50);

    res.json(logs);
  } catch {
    res.status(500).json({ error: "Failed to fetch subscription history" });
  }
});

/**
 * GET /subscription/payments
 * Returns payment records for this laundry.
 */
subscriptionRouter.get("/payments", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const payments = await db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.laundryId, laundryId))
      .orderBy(desc(subscriptionPayments.createdAt))
      .limit(50);

    res.json(payments);
  } catch {
    res.status(500).json({ error: "Failed to fetch payment records" });
  }
});

/**
 * POST /subscription/upgrade-intent
 * Logs when an owner clicks an upgrade button.
 * No payment processing — records intent only.
 */
const upgradeIntentSchema = z.object({
  targetPlan: z.enum(["starter", "pro", "business"]),
  currentPlan: z.string().optional(),
  source: z.string().optional(),
});

subscriptionRouter.post("/upgrade-intent", requireOwner, async (req: AuthRequest, res) => {
  try {
    const data = upgradeIntentSchema.parse(req.body);
    const laundryId = req.auth!.laundryId;

    const [laundry] = await db
      .select({ subscriptionStatus: laundries.subscriptionStatus, subscriptionTier: laundries.subscriptionTier })
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    if (!laundry) return res.status(404).json({ error: "Not found" });

    await db.insert(subscriptionLogs).values({
      laundryId,
      fromStatus: laundry.subscriptionStatus as SubscriptionStatus,
      toStatus: laundry.subscriptionStatus as SubscriptionStatus,
      fromPlan: laundry.subscriptionTier,
      toPlan: data.targetPlan,
      reason: "upgrade_clicked",
      changedBy: "owner",
      metadata: {
        event: "upgrade_clicked",
        targetPlan: data.targetPlan,
        currentPlan: data.currentPlan ?? laundry.subscriptionTier,
        source: data.source ?? "billing_settings",
        timestamp: new Date().toISOString(),
      },
    });

    res.json({
      logged: true,
      targetPlan: data.targetPlan,
      message: "Upgrade intent recorded. Contact support to complete your upgrade.",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    res.status(500).json({ error: "Failed to log upgrade intent" });
  }
});

/**
 * POST /subscription/cancel
 * Owner can self-cancel their subscription.
 * Sets status to "cancelled" and sends retention email.
 */
subscriptionRouter.post("/cancel", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const [laundry] = await db
      .select({
        subscriptionStatus: laundries.subscriptionStatus,
        subscriptionTier: laundries.subscriptionTier,
        ownerEmail: laundries.ownerEmail,
        businessName: laundries.businessName,
      })
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    if (!laundry) return res.status(404).json({ error: "Not found" });

    if (laundry.subscriptionStatus === "cancelled") {
      return res.status(409).json({ error: "Subscription is already cancelled." });
    }

    await db.update(laundries)
      .set({ subscriptionStatus: "cancelled", updatedAt: new Date() })
      .where(eq(laundries.id, laundryId));

    await db.insert(subscriptionLogs).values({
      laundryId,
      fromStatus: laundry.subscriptionStatus as SubscriptionStatus,
      toStatus: "cancelled",
      fromPlan: laundry.subscriptionTier,
      toPlan: laundry.subscriptionTier,
      reason: "owner_cancelled",
      changedBy: "owner",
      metadata: { cancelledAt: new Date().toISOString() },
    });

    // Send retention email (fire-and-forget)
    sendLifecycleEmail(
      laundryId,
      laundry.ownerEmail,
      laundry.businessName,
      "cancellation_retention"
    ).catch(() => {});

    res.json({ cancelled: true, message: "Your subscription has been cancelled. Your data is preserved." });
  } catch {
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// ── Phase 7.8: Payment Automation & Billing Infrastructure ──────────────────

/**
 * GET /subscription/payment-config
 * Tells the frontend whether card payments are available and, if so, the
 * public key needed to render the checkout button state.
 */
subscriptionRouter.get("/payment-config", requireOwner, (_req, res) => {
  res.json({
    paystackConfigured: isPaystackConfigured(),
    paystackPublicKey: isPaystackConfigured() ? getPaystackPublicKey() : null,
  });
});

const checkoutSchema = z.object({
  targetPlan: z.enum(PAID_PLANS as unknown as [PaidPlan, ...PaidPlan[]]),
  billingPeriod: z.enum(["monthly", "annual"]).default("monthly"),
});

/**
 * POST /subscription/checkout
 * Starts a Paystack hosted checkout for a new subscription, upgrade, or
 * downgrade. Returns a URL the frontend redirects the browser to.
 */
subscriptionRouter.post("/checkout", requireOwner, async (req: AuthRequest, res) => {
  try {
    const data = checkoutSchema.parse(req.body);
    const laundryId = req.auth!.laundryId;

    const [laundry] = await db
      .select({ subscriptionTier: laundries.subscriptionTier, subscriptionStatus: laundries.subscriptionStatus })
      .from(laundries)
      .where(eq(laundries.id, laundryId));
    if (!laundry) return res.status(404).json({ error: "Not found" });

    const currentRank = PAID_PLANS.indexOf(laundry.subscriptionTier as PaidPlan);
    const targetRank = PAID_PLANS.indexOf(data.targetPlan);
    let purpose: "new_subscription" | "upgrade" | "downgrade" | "reactivation" = "new_subscription";
    if (laundry.subscriptionStatus === "cancelled") purpose = "reactivation";
    else if (currentRank >= 0 && targetRank > currentRank) purpose = "upgrade";
    else if (currentRank >= 0 && targetRank < currentRank) purpose = "downgrade";

    const result = await startCheckout({
      laundryId,
      targetPlan: data.targetPlan,
      billingPeriod: data.billingPeriod,
      purpose,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start checkout" });
  }
});

/**
 * POST /subscription/reactivate
 * Owner-initiated reactivation of a cancelled subscription — same flow as
 * checkout, exposed separately so the frontend can present distinct copy.
 */
subscriptionRouter.post("/reactivate", requireOwner, async (req: AuthRequest, res) => {
  try {
    const data = checkoutSchema.parse(req.body);
    const laundryId = req.auth!.laundryId;

    const result = await startCheckout({
      laundryId,
      targetPlan: data.targetPlan,
      billingPeriod: data.billingPeriod,
      purpose: "reactivation",
    });

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start reactivation" });
  }
});

/**
 * POST /subscription/verify-payment
 * Fallback verification for the browser return-from-checkout page, in case
 * the Paystack webhook hasn't landed yet. Idempotent — safe to poll.
 */
const verifySchema = z.object({ reference: z.string().min(1) });

subscriptionRouter.post("/verify-payment", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { reference } = verifySchema.parse(req.body);
    const result = await verifyAndActivate(reference);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

/**
 * POST /subscription/retry-payment
 * Re-initiates checkout for a failed/pending invoice — reuses the same
 * plan/billing period recorded on that invoice.
 */
subscriptionRouter.post("/retry-payment", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const invoiceId = Number(req.body?.invoiceId);
    if (!invoiceId) return res.status(400).json({ error: "invoiceId is required" });

    const invoice = await getInvoice(laundryId, invoiceId);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.status === "paid") return res.status(409).json({ error: "Invoice is already paid" });
    if (!PAID_PLANS.includes(invoice.plan as PaidPlan)) {
      return res.status(400).json({ error: "Invoice plan is not a billable plan" });
    }

    const result = await startCheckout({
      laundryId,
      targetPlan: invoice.plan as PaidPlan,
      billingPeriod: (invoice.billingPeriod as "monthly" | "annual") ?? "monthly",
      purpose: "new_subscription",
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to retry payment" });
  }
});

/**
 * GET /subscription/invoices
 * Lists this laundry's permanent invoice history.
 */
subscriptionRouter.get("/invoices", requireOwner, async (req: AuthRequest, res) => {
  try {
    const invoices = await listInvoices(req.auth!.laundryId);
    res.json(invoices);
  } catch {
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

/**
 * GET /subscription/invoices/:id/html
 * Print-friendly standalone invoice document (browser "print to PDF").
 */
subscriptionRouter.get("/invoices/:id/html", requireOwner, async (req: AuthRequest, res) => {
  try {
    const invoice = await getInvoice(req.auth!.laundryId, Number(req.params.id));
    if (!invoice) return res.status(404).send("Invoice not found");
    res.setHeader("Content-Type", "text/html");
    res.send(renderInvoiceHtml(invoice));
  } catch {
    res.status(500).send("Failed to render invoice");
  }
});

/**
 * GET /subscription/billing-status
 * Recurring-billing state (saved card on file, next charge date) for the
 * Billing settings page.
 */
subscriptionRouter.get("/billing-status", requireOwner, async (req: AuthRequest, res) => {
  try {
    const [sub] = await db
      .select({
        cardLast4: paymentSubscriptions.cardLast4,
        cardBank: paymentSubscriptions.cardBank,
        cardType: paymentSubscriptions.cardType,
        status: paymentSubscriptions.status,
        nextChargeAt: paymentSubscriptions.nextChargeAt,
        consecutiveFailures: paymentSubscriptions.consecutiveFailures,
        lastChargeAt: paymentSubscriptions.lastChargeAt,
        lastChargeStatus: paymentSubscriptions.lastChargeStatus,
      })
      .from(paymentSubscriptions)
      .where(eq(paymentSubscriptions.laundryId, req.auth!.laundryId));

    res.json({ hasCardOnFile: !!sub, ...(sub ?? {}) });
  } catch {
    res.status(500).json({ error: "Failed to fetch billing status" });
  }
});
