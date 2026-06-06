import { Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { laundries } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { AuthRequest } from "./auth.js";
import { hasFeature, type PlanFeature } from "../lib/entitlements.js";

async function getLaundrySubscription(laundryId: number) {
  const [row] = await db
    .select({
      subscriptionStatus: laundries.subscriptionStatus,
      subscriptionTier: laundries.subscriptionTier,
    })
    .from(laundries)
    .where(eq(laundries.id, laundryId));
  return row ?? null;
}

export async function requireOperational(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const laundryId = req.auth?.laundryId;
  if (!laundryId) return next();

  try {
    const sub = await getLaundrySubscription(laundryId);
    if (!sub) return next();

    if (sub.subscriptionStatus === "suspended") {
      return res.status(403).json({
        error: "Account suspended",
        code: "SUBSCRIPTION_SUSPENDED",
        message:
          "Your account is suspended. Please contact support to resume operations.",
      });
    }

    if (sub.subscriptionStatus === "cancelled") {
      return res.status(403).json({
        error: "Account cancelled",
        code: "SUBSCRIPTION_CANCELLED",
        message:
          "Your account has been cancelled. Historical data is still accessible.",
      });
    }

    next();
  } catch {
    next();
  }
}

export function requireEntitlement(feature: PlanFeature) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const laundryId = req.auth?.laundryId;
    if (!laundryId) return next();

    try {
      const sub = await getLaundrySubscription(laundryId);
      if (!sub) return next();

      if (!hasFeature(sub.subscriptionTier, feature)) {
        return res.status(403).json({
          error: "Feature not available",
          code: "ENTITLEMENT_DENIED",
          feature,
          message: `This feature (${feature}) is not included in your current plan (${sub.subscriptionTier}). Upgrade to unlock it.`,
        });
      }

      next();
    } catch {
      next();
    }
  };
}
