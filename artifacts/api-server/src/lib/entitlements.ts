import { getPlanPricing, getPricingList } from "./pricing.js";

export const SUBSCRIPTION_PLANS = ["free", "starter", "pro", "business"] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const PLAN_DISPLAY_NAMES: Record<SubscriptionPlan, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Professional",
  business: "Enterprise",
};

export const PLAN_FEATURES = {
  free: {
    HAS_WHATSAPP: false,
    HAS_WHATSAPP_CAMPAIGNS: false,
    HAS_MULTI_BRANCH: false,
    HAS_MARKETING_TOOLS: false,
    HAS_AI_MARKETING: false,
    HAS_CUSTOMER_SEGMENTATION: false,
    HAS_ANALYTICS: false,
    HAS_ADVANCED_ANALYTICS: false,
    HAS_BATCH_PROCESSING: false,
    HAS_API_ACCESS: false,
    HAS_EXPENSE_TRACKING: false,
    HAS_ADVANCED_REPORTS: false,
  },
  starter: {
    // WhatsApp transactional only (Order Created, Order Ready, Pickup Reminder, Payment Reminder)
    HAS_WHATSAPP: true,
    HAS_WHATSAPP_CAMPAIGNS: false,
    HAS_MULTI_BRANCH: false,
    HAS_MARKETING_TOOLS: false,
    HAS_AI_MARKETING: false,
    HAS_CUSTOMER_SEGMENTATION: false,
    HAS_ANALYTICS: true,
    HAS_ADVANCED_ANALYTICS: false,
    HAS_BATCH_PROCESSING: false,
    HAS_API_ACCESS: false,
    HAS_EXPENSE_TRACKING: false,
    HAS_ADVANCED_REPORTS: false,
  },
  pro: {
    HAS_WHATSAPP: true,
    HAS_WHATSAPP_CAMPAIGNS: true,
    HAS_MULTI_BRANCH: true,
    HAS_MARKETING_TOOLS: true,
    HAS_AI_MARKETING: true,
    HAS_CUSTOMER_SEGMENTATION: true,
    HAS_ANALYTICS: true,
    HAS_ADVANCED_ANALYTICS: true,
    HAS_BATCH_PROCESSING: true,
    HAS_API_ACCESS: false,
    HAS_EXPENSE_TRACKING: true,
    HAS_ADVANCED_REPORTS: true,
  },
  business: {
    HAS_WHATSAPP: true,
    HAS_WHATSAPP_CAMPAIGNS: true,
    HAS_MULTI_BRANCH: true,
    HAS_MARKETING_TOOLS: true,
    HAS_AI_MARKETING: true,
    HAS_CUSTOMER_SEGMENTATION: true,
    HAS_ANALYTICS: true,
    HAS_ADVANCED_ANALYTICS: true,
    HAS_BATCH_PROCESSING: true,
    HAS_API_ACCESS: true,
    HAS_EXPENSE_TRACKING: true,
    HAS_ADVANCED_REPORTS: true,
  },
} as const satisfies Record<SubscriptionPlan, Record<string, boolean>>;

export type PlanFeature = keyof typeof PLAN_FEATURES.business;

export const PLAN_LIMITS: Record<SubscriptionPlan, {
  maxBranches: number;
  maxWorkers: number;
  maxOrdersPerMonth: number;
  maxCustomers: number;
}> = {
  free:     { maxBranches: 1,        maxWorkers: 2,        maxOrdersPerMonth: 100,      maxCustomers: 100 },
  starter:  { maxBranches: 1,        maxWorkers: 2,        maxOrdersPerMonth: 500,      maxCustomers: 500 },
  pro:      { maxBranches: 5,        maxWorkers: Infinity, maxOrdersPerMonth: Infinity, maxCustomers: Infinity },
  business: { maxBranches: Infinity, maxWorkers: Infinity, maxOrdersPerMonth: Infinity, maxCustomers: Infinity },
};

export const DEFAULT_TRIAL_DAYS = 14;
export const GRACE_PERIOD_DAYS = 7;

/**
 * During the 14-day trial, users get Enterprise-level features and limits
 * so they can experience the full product before choosing a plan.
 */
export const TRIAL_FEATURE_TIER = "business" as const;

export function getPlanFeatures(plan: string): typeof PLAN_FEATURES.free {
  return (PLAN_FEATURES as any)[plan] ?? PLAN_FEATURES.free;
}

export function getPlanLimits(plan: string): typeof PLAN_LIMITS.free {
  return (PLAN_LIMITS as any)[plan] ?? PLAN_LIMITS.free;
}

/**
 * Returns the effective feature set for a subscription, accounting for trial.
 * Trial users receive Enterprise-level features regardless of their underlying tier.
 */
export function getEffectivePlanFeatures(tier: string, status?: string | null): typeof PLAN_FEATURES.free {
  const effectiveTier = status === "trial" ? TRIAL_FEATURE_TIER : tier;
  return (PLAN_FEATURES as any)[effectiveTier] ?? PLAN_FEATURES.free;
}

/**
 * Returns the effective plan limits, accounting for trial.
 * Trial users receive Enterprise-level limits (unlimited everything).
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
    limits: { maxBranches: number; maxWorkers: number; maxOrdersPerMonth: number; maxCustomers: number };
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
      "HAS_WHATSAPP — checked before sending WhatsApp messages (all plans except free)",
      "HAS_WHATSAPP_CAMPAIGNS — checked before scheduled WhatsApp campaigns (Professional+)",
      "HAS_MULTI_BRANCH — checked before creating a second branch (Professional+)",
      "HAS_MARKETING_TOOLS — checked before marketing campaign routes (Professional+)",
      "HAS_AI_MARKETING — checked before AI marketing assistant (Professional+)",
      "HAS_CUSTOMER_SEGMENTATION — checked before segmentation queries (Professional+)",
      "HAS_ANALYTICS — checked before accessing analytics endpoints (Starter+)",
      "HAS_ADVANCED_ANALYTICS — checked before advanced analytics (Professional+)",
      "HAS_BATCH_PROCESSING — checked before batch order processing (Professional+)",
      "HAS_API_ACCESS — checked before external API access (Enterprise)",
      "HAS_EXPENSE_TRACKING — checked before expense routes (Professional+)",
      "HAS_ADVANCED_REPORTS — checked before advanced reports (Professional+)",
    ],
    futureCompatible: [
      "Add new features to PLAN_FEATURES without schema changes",
      "Add new plans by extending SUBSCRIPTION_PLANS and PLAN_FEATURES",
      "hasFeature() is the single check point — no redesign needed for new features",
      "getPlanLimits() provides numeric enforcement separate from feature flags",
      "Pricing config in pricing.ts is payment-gateway-ready (paystackPlanCode field)",
      "Plans table in DB is source of truth for display/marketing copy",
    ],
  };
}
