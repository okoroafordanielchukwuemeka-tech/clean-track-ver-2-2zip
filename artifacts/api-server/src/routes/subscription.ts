import { Router } from "express";
import { db } from "@workspace/db";
import { laundries, subscriptionLogs, subscriptionPayments } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { getEffectivePlanFeatures, getEffectivePlanLimits, PLAN_DISPLAY_NAMES, getEntitlementReport } from "../lib/entitlements.js";
import { computeUsageWithLimits } from "../lib/usage-service.js";
import { getPricingList, MANUAL_PAYMENT_INSTRUCTIONS } from "../lib/pricing.js";
import type { SubscriptionStatus } from "@workspace/db/schema";
import { sendLifecycleEmail } from "../lib/email-lifecycle.js";

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
    const limits = getEffectivePlanLimits(laundry.subscriptionTier, laundry.subscriptionStatus);
    const planDisplayName = (PLAN_DISPLAY_NAMES as any)[laundry.subscriptionTier] ?? laundry.subscriptionTier;

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
