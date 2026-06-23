/**
 * CleanTrack — Centralized Pricing Configuration
 *
 * Single source of truth for all plan pricing.
 * All amounts are in Nigerian Naira (NGN).
 *
 * DB tier mapping:
 *   "free"     → internal trial/free tier (no price)
 *   "starter"  → Starter plan  (₦5,000/mo)
 *   "pro"      → Growth plan   (₦10,000/mo)
 *   "business" → Business plan (₦20,000/mo)
 *
 * When Paystack/Flutterwave integration is added, the planCode fields
 * will be populated with the provider's plan codes.
 */

export const CURRENCY = "NGN" as const;
export const CURRENCY_SYMBOL = "₦" as const;

export interface PlanPrice {
  monthly: number;
  annual: number;
  annualSavingsPct: number;
  currency: typeof CURRENCY;
}

export interface PlanPricingConfig {
  tier: string;
  displayName: string;
  tagline: string;
  price: PlanPrice;
  features: string[];
  highlighted: boolean;
  paystackPlanCode?: string;
  flutterwavePlanId?: string;
}

export const PLAN_PRICING: Record<string, PlanPricingConfig> = {
  starter: {
    tier: "starter",
    displayName: "Starter",
    tagline: "Perfect for a single-location laundry",
    price: {
      monthly: 5_000,
      annual: 50_000,
      annualSavingsPct: 17,
      currency: CURRENCY,
    },
    features: [
      "1 branch",
      "Up to 5 workers",
      "Unlimited customers",
      "Unlimited orders",
      "Basic dashboard analytics",
      "Order & payment tracking",
      "Customer receipts",
    ],
    highlighted: false,
  },
  pro: {
    tier: "pro",
    displayName: "Growth",
    tagline: "For growing multi-location businesses",
    price: {
      monthly: 10_000,
      annual: 100_000,
      annualSavingsPct: 17,
      currency: CURRENCY,
    },
    features: [
      "Up to 3 branches",
      "Up to 20 workers",
      "Unlimited customers",
      "Unlimited orders",
      "Advanced analytics & reports",
      "Expense tracking",
      "Batch order processing",
      "Priority email support",
    ],
    highlighted: true,
  },
  business: {
    tier: "business",
    displayName: "Business",
    tagline: "Enterprise-grade for large operations",
    price: {
      monthly: 20_000,
      annual: 200_000,
      annualSavingsPct: 17,
      currency: CURRENCY,
    },
    features: [
      "Unlimited branches",
      "Unlimited workers",
      "Unlimited customers",
      "Unlimited orders",
      "Full analytics suite",
      "WhatsApp notifications",
      "Marketing tools",
      "Priority support",
      "Custom branding",
    ],
    highlighted: false,
  },
};

export const PAID_PLANS = ["starter", "pro", "business"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function getPlanPricing(tier: string): PlanPricingConfig | null {
  return PLAN_PRICING[tier] ?? null;
}

export function formatNGN(amount: number): string {
  return `${CURRENCY_SYMBOL}${amount.toLocaleString("en-NG")}`;
}

export function getPricingList(): PlanPricingConfig[] {
  return PAID_PLANS.map((t) => PLAN_PRICING[t]);
}

export const MANUAL_PAYMENT_INSTRUCTIONS = {
  bankName: "Contact CleanTrack Support",
  contactWhatsApp: process.env.SUPPORT_WHATSAPP ?? "",
  contactEmail: process.env.SUPPORT_EMAIL ?? "support@cleantrack.ng",
  instructions: [
    "Choose your plan below",
    "Contact our support team via WhatsApp or email",
    "Make payment via bank transfer",
    "Your plan will be activated within 24 hours",
  ],
};
