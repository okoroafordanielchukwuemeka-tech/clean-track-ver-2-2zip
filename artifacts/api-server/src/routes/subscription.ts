import { Router } from "express";
import { db } from "@workspace/db";
import { laundries } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { getPlanFeatures, getPlanLimits, PLAN_DISPLAY_NAMES, getEntitlementReport } from "../lib/entitlements.js";
import { computeUsageWithLimits } from "../lib/usage-service.js";

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

    const features = getPlanFeatures(laundry.subscriptionTier);
    const limits = getPlanLimits(laundry.subscriptionTier);
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

    res.json({
      status: laundry.subscriptionStatus,
      plan: laundry.subscriptionTier,
      planDisplayName,
      trialStartedAt: laundry.trialStartedAt,
      trialEndsAt: laundry.trialEndsAt,
      trialDaysRemaining,
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
      .select({ subscriptionTier: laundries.subscriptionTier })
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    if (!laundry) return res.status(404).json({ error: "Not found" });

    const usage = await computeUsageWithLimits(laundryId, laundry.subscriptionTier);
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
