import { getPlanPricing, getPricingList } from "./pricing.js";

export const SUBSCRIPTION_PLANS = ["free", "starter", "pro", "business"] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const PLAN_DISPLAY_NAMES: Record<SubscriptionPlan, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Growth",
  business: "Business",
};

export const PLAN_FEATURES = {
  free: {
    HAS_WHATSAPP: false,
    HAS_MULTI_BRANCH: false,
    HAS_MARKETING_TOOLS: false,
    HAS_ANALYTICS: false,
    HAS_BATCH_PROCESSING: false,
  },
  starter: {
    HAS_WHATSAPP: false,
    HAS_MULTI_BRANCH: false,
    HAS_MARKETING_TOOLS: false,
    HAS_ANALYTICS: true,
    HAS_BATCH_PROCESSING: false,
  },
  pro: {
    HAS_WHATSAPP: false,
    HAS_MULTI_BRANCH: true,
    HAS_MARKETING_TOOLS: false,
    HAS_ANALYTICS: true,
    HAS_BATCH_PROCESSING: true,
  },
  business: {
    HAS_WHATSAPP: true,
    HAS_MULTI_BRANCH: true,
    HAS_MARKETING_TOOLS: true,
    HAS_ANALYTICS: true,
    HAS_BATCH_PROCESSING: true,
  },
} as const satisfies Record<SubscriptionPlan, Record<string, boolean>>;

export type PlanFeature = keyof typeof PLAN_FEATURES.business;

export const PLAN_LIMITS: Record<SubscriptionPlan, {
  maxBranches: number;
  maxWorkers: number;
  maxOrdersPerMonth: number;
}> = {
  free:     { maxBranches: 1,        maxWorkers: 3,        maxOrdersPerMonth: 100 },
  starter:  { maxBranches: 1,        maxWorkers: 5,        maxOrdersPerMonth: Infinity },
  pro:      { maxBranches: 3,        maxWorkers: 20,       maxOrdersPerMonth: Infinity },
  business: { maxBranches: Infinity, maxWorkers: Infinity, maxOrdersPerMonth: Infinity },
};

export const DEFAULT_TRIAL_DAYS = 14;
export const GRACE_PERIOD_DAYS = 7;

/**
 * During the 14-day trial, users get Growth (pro) level features and limits.
 * This lets them experience the full product before paying.
 */
export const TRIAL_FEATURE_TIER = "pro" as const;

export function getPlanFeatures(plan: string): typeof PLAN_FEATURES.free {
  return (PLAN_FEATURES as any)[plan] ?? PLAN_FEATURES.free;
}

export function getPlanLimits(plan: string): typeof PLAN_LIMITS.free {
  return (PLAN_LIMITS as any)[plan] ?? PLAN_LIMITS.free;
}

/**
 * Returns the effective feature set for a subscription, accounting for trial.
 * Trial users receive Growth-level features regardless of their underlying tier.
 */
export function getEffectivePlanFeatures(tier: string, status?: string | null): typeof PLAN_FEATURES.free {
  const effectiveTier = status === "trial" ? TRIAL_FEATURE_TIER : tier;
  return (PLAN_FEATURES as any)[effectiveTier] ?? PLAN_FEATURES.free;
}

/**
 * Returns the effective plan limits, accounting for trial.
 * Trial users receive Growth-level limits (3 branches, 20 workers, unlimited orders).
 */
export function getEffectivePlanLimits(tier: string, status?: string | null): typeof PLAN_LIMITS.free {
  const effectiveTier = status === "trial" ? TRIAL_FEATURE_TIER : tier;
  return (PLAN_LIMITS as any)[effectiveTier] ?? PLAN_LIMITS.free;
}

export function hasFeature(plan: string, feature: PlanFeature): boolean {
  const features = getPlanFeatures(plan);
  return (features as any)[feature] ?? false;
}

export function getEntitlementReport(): {
  plans: Array<{
    plan: string;
    displayName: string;
    features: Record<string, boolean>;
    limits: { maxBranches: number; maxWorkers: number; maxOrdersPerMonth: number };
    pricing: ReturnType<typeof getPlanPricing>;
  }>;
  enforcement: string[];
  futureCompatible: string[];
} {
  return {
    plans: SUBSCRIPTION_PLANS.map((plan) => ({
      plan,
      displayName: PLAN_DISPLAY_NAMES[plan],
      features: getPlanFeatures(plan) as Record<string, boolean>,
      limits: getPlanLimits(plan),
      pricing: getPlanPricing(plan),
    })),
    enforcement: [
      "HAS_WHATSAPP — checked before sending WhatsApp messages via communication routes",
      "HAS_MULTI_BRANCH — checked before creating a second branch",
      "HAS_MARKETING_TOOLS — reserved for future marketing campaign routes",
      "HAS_ANALYTICS — checked before accessing advanced analytics endpoints",
      "HAS_BATCH_PROCESSING — checked before using batch order processing",
    ],
    futureCompatible: [
      "Add new features to PLAN_FEATURES without schema changes",
      "Add new plans by extending SUBSCRIPTION_PLANS and PLAN_FEATURES",
      "hasFeature() is the single check point — no redesign needed for new features",
      "getPlanLimits() provides numeric enforcement separate from feature flags",
      "Pricing config in pricing.ts is payment-gateway-ready (paystackPlanCode field)",
    ],
  };
}
