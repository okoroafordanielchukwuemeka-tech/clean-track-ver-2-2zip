import { Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { laundries } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { AuthRequest } from "./auth.js";
import { hasFeature, type PlanFeature, GRACE_PERIOD_DAYS, TRIAL_FEATURE_TIER } from "../lib/entitlements.js";
import { checkLimit } from "../lib/usage-service.js";

async function getLaundrySubscription(laundryId: number) {
  const [row] = await db
    .select({
      subscriptionStatus: laundries.subscriptionStatus,
      subscriptionTier: laundries.subscriptionTier,
      subscriptionRenewsAt: laundries.subscriptionRenewsAt,
      trialEndsAt: laundries.trialEndsAt,
    })
    .from(laundries)
    .where(eq(laundries.id, laundryId));
  return row ?? null;
}

/**
 * Returns true if a past_due account is still within its grace period.
 * Grace deadline is stored in subscriptionRenewsAt when the trial expires.
 * If renewsAt is null (manually set past_due), allow access for GRACE_PERIOD_DAYS.
 */
function isWithinGracePeriod(renewsAt: Date | null): boolean {
  if (!renewsAt) return true;
  return new Date() <= new Date(renewsAt);
}

/**
 * Returns true when an account is in "trial" status but trial_ends_at has passed.
 * These accounts must be treated like the free/base tier — no premium feature access
 * and operations are blocked until they upgrade.
 */
function isTrialExpired(sub: { subscriptionStatus: string; trialEndsAt: Date | null }): boolean {
  return (
    sub.subscriptionStatus === "trial" &&
    sub.trialEndsAt !== null &&
    new Date() > new Date(sub.trialEndsAt)
  );
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

    // Block operations when trial has expired but subscription_status is still "trial"
    // (status is updated async by the scheduler; check trial_ends_at as ground truth)
    if (isTrialExpired(sub)) {
      return res.status(403).json({
        error: "Trial expired",
        code: "TRIAL_EXPIRED",
        message:
          "Your 14-day trial has ended. Upgrade to a paid plan to continue creating orders, workers, and customers.",
      });
    }

    if (sub.subscriptionStatus === "suspended") {
      return res.status(403).json({
        error: "Account suspended",
        code: "SUBSCRIPTION_SUSPENDED",
        message:
          "Your account is suspended. Please contact support or upgrade your plan to resume operations.",
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

    if (sub.subscriptionStatus === "past_due") {
      if (!isWithinGracePeriod(sub.subscriptionRenewsAt)) {
        return res.status(403).json({
          error: "Account suspended — grace period expired",
          code: "SUBSCRIPTION_SUSPENDED",
          message: `Your ${GRACE_PERIOD_DAYS}-day grace period has ended. Please contact support or upgrade your plan to resume operations.`,
        });
      }
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

      // During an active trial users get Growth-level features;
      // once trial_ends_at has passed, fall back to their base tier (free)
      const effectiveTier =
        sub.subscriptionStatus === "trial" && !isTrialExpired(sub)
          ? TRIAL_FEATURE_TIER
          : sub.subscriptionTier;

      if (!hasFeature(effectiveTier, feature)) {
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

/**
 * Hard plan limit enforcement middleware.
 * Call AFTER requireOperational so suspended/cancelled accounts are caught first.
 * Returns HTTP 403 with a machine-readable code if the plan limit is exceeded.
 * Trial accounts use Growth-level limits.
 */
export function requirePlanLimit(limitType: "orders" | "workers" | "branches" | "customers") {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const laundryId = req.auth?.laundryId;
    if (!laundryId) return next();

    try {
      const sub = await getLaundrySubscription(laundryId);
      if (!sub) return next();

      // During an active trial enforce Growth (pro) limits; expired trials use base (free) limits
      const effectiveTier =
        sub.subscriptionStatus === "trial" && !isTrialExpired(sub)
          ? TRIAL_FEATURE_TIER
          : sub.subscriptionTier;

      const limitError = await checkLimit(laundryId, effectiveTier, limitType);
      if (limitError) {
        return res.status(403).json({
          error: limitError.message,
          code: limitError.code,
        });
      }

      next();
    } catch {
      next();
    }
  };
}
