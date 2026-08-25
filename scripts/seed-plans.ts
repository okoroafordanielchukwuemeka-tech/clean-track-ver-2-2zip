/**
 * Seed the plans table with the canonical CleanTrack plan definitions.
 *
 * Run with: pnpm tsx scripts/seed-plans.ts
 *
 * This is idempotent — uses ON CONFLICT (tier) DO UPDATE, so safe to re-run
 * to apply updated values (prices, limits, features) without manual SQL.
 */

import { db } from "@workspace/db";
import { plans } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

const PLAN_ROWS = [
  {
    tier: "free",
    displayName: "Free",
    tagline: "Get started for free",
    monthlyPriceNgn: 0,
    annualPriceNgn: 0,
    maxOrdersPerMonth: 100,
    maxWorkers: 1,
    maxBranches: 1,
    maxCustomers: 100,
    maxStorageMb: 512,
    maxWhatsappMessagesPerMonth: 0,
    maxAiCreditsPerMonth: 0,
    features: {
      HAS_ANALYTICS: false,
      HAS_WHATSAPP: false,
      HAS_WHATSAPP_CAMPAIGNS: false,
      HAS_AI_MARKETING: false,
      HAS_CUSTOMER_SEGMENTATION: false,
      HAS_ADVANCED_ANALYTICS: false,
      HAS_EXPENSE_TRACKING: false,
      HAS_ADVANCED_REPORTS: false,
      HAS_API_ACCESS: false,
      HAS_BATCH_PROCESSING: false,
      HAS_MULTI_BRANCH: false,
      HAS_SLA_MANAGEMENT: false,
    },
    marketingFeatures: [],
    isHighlighted: false,
    isActive: true,
    sortOrder: 0,
  },
  {
    tier: "starter",
    displayName: "Starter",
    tagline: "Perfect for a single-location laundry",
    monthlyPriceNgn: 10_000,
    annualPriceNgn: 100_000,
    maxOrdersPerMonth: 500,
    maxWorkers: 3,
    maxBranches: 1,
    maxCustomers: 500,
    maxStorageMb: 5_120,       // 5 GB
    maxWhatsappMessagesPerMonth: 500,
    maxAiCreditsPerMonth: 20,
    features: {
      HAS_ANALYTICS: true,
      HAS_WHATSAPP: true,
      HAS_WHATSAPP_CAMPAIGNS: false,
      HAS_AI_MARKETING: false,
      HAS_CUSTOMER_SEGMENTATION: false,
      HAS_ADVANCED_ANALYTICS: false,
      HAS_EXPENSE_TRACKING: true,
      HAS_ADVANCED_REPORTS: false,
      HAS_API_ACCESS: false,
      HAS_BATCH_PROCESSING: true,
      HAS_MULTI_BRANCH: false,
      HAS_SLA_MANAGEMENT: false,
    },
    marketingFeatures: [
      "1 branch",
      "Up to 3 workers",
      "Up to 500 active customers",
      "500 orders per month",
      "5 GB storage",
      "500 WhatsApp messages/month",
      "20 AI credits/month",
      "Customer management & statements",
      "Order, payment & pickup tracking",
      "WhatsApp transactional notifications",
      "Basic email notifications",
    ],
    isHighlighted: false,
    isActive: true,
    sortOrder: 1,
  },
  {
    tier: "pro",
    displayName: "Professional",
    tagline: "For growing multi-location businesses",
    monthlyPriceNgn: 20_000,
    annualPriceNgn: 200_000,
    maxOrdersPerMonth: 5_000,
    maxWorkers: 6,
    maxBranches: 3,
    maxCustomers: 5_000,
    maxStorageMb: 25_600,      // 25 GB
    maxWhatsappMessagesPerMonth: 5_000,
    maxAiCreditsPerMonth: 200,
    features: {
      HAS_ANALYTICS: true,
      HAS_WHATSAPP: true,
      HAS_WHATSAPP_CAMPAIGNS: true,
      HAS_AI_MARKETING: true,
      HAS_CUSTOMER_SEGMENTATION: true,
      HAS_ADVANCED_ANALYTICS: true,
      HAS_EXPENSE_TRACKING: true,
      HAS_ADVANCED_REPORTS: true,
      HAS_API_ACCESS: false,
      HAS_BATCH_PROCESSING: true,
      HAS_MULTI_BRANCH: true,
      HAS_SLA_MANAGEMENT: true,
    },
    marketingFeatures: [
      "Up to 3 branches",
      "Up to 6 workers",
      "Up to 5,000 customers",
      "5,000 orders per month",
      "25 GB storage",
      "5,000 WhatsApp messages/month",
      "200 AI credits/month",
      "Advanced analytics & revenue reports",
      "Expense tracking & profitability",
      "Customer segmentation",
      "Marketing campaigns",
      "Scheduled WhatsApp campaigns",
      "AI Marketing Assistant",
      "Batch order processing",
      "Priority email support",
    ],
    isHighlighted: true,
    isActive: true,
    sortOrder: 2,
  },
  {
    tier: "business",
    displayName: "Enterprise",
    tagline: "Enterprise-grade for large operations",
    monthlyPriceNgn: 0,   // Contact Sales — price is negotiated
    annualPriceNgn: 0,
    maxOrdersPerMonth: null,   // null = unlimited
    maxWorkers: null,
    maxBranches: null,
    maxCustomers: null,
    maxStorageMb: null,
    maxWhatsappMessagesPerMonth: null,
    maxAiCreditsPerMonth: null,
    features: {
      HAS_ANALYTICS: true,
      HAS_WHATSAPP: true,
      HAS_WHATSAPP_CAMPAIGNS: true,
      HAS_AI_MARKETING: true,
      HAS_CUSTOMER_SEGMENTATION: true,
      HAS_ADVANCED_ANALYTICS: true,
      HAS_EXPENSE_TRACKING: true,
      HAS_ADVANCED_REPORTS: true,
      HAS_API_ACCESS: true,
      HAS_BATCH_PROCESSING: true,
      HAS_MULTI_BRANCH: true,
      HAS_SLA_MANAGEMENT: true,
    },
    marketingFeatures: [
      "Unlimited branches",
      "Unlimited workers",
      "Unlimited customers",
      "Unlimited orders",
      "Full analytics suite",
      "WhatsApp campaigns & automation",
      "AI Business Advisor",
      "API access for integrations",
      "Advanced reports & custom roles",
      "White label options (future)",
      "Dedicated support",
    ],
    isHighlighted: false,
    isActive: true,
    sortOrder: 3,
  },
];

async function main() {
  console.log("Seeding plans table…");

  for (const plan of PLAN_ROWS) {
    await db
      .insert(plans)
      .values(plan)
      .onConflictDoUpdate({
        target: plans.tier,
        set: {
          displayName:                 sql`EXCLUDED.display_name`,
          tagline:                     sql`EXCLUDED.tagline`,
          monthlyPriceNgn:             sql`EXCLUDED.monthly_price_ngn`,
          annualPriceNgn:              sql`EXCLUDED.annual_price_ngn`,
          maxOrdersPerMonth:           sql`EXCLUDED.max_orders_per_month`,
          maxWorkers:                  sql`EXCLUDED.max_workers`,
          maxBranches:                 sql`EXCLUDED.max_branches`,
          maxCustomers:                sql`EXCLUDED.max_customers`,
          maxStorageMb:                sql`EXCLUDED.max_storage_mb`,
          maxWhatsappMessagesPerMonth: sql`EXCLUDED.max_whatsapp_messages_per_month`,
          maxAiCreditsPerMonth:        sql`EXCLUDED.max_ai_credits_per_month`,
          features:                    sql`EXCLUDED.features`,
          marketingFeatures:           sql`EXCLUDED.marketing_features`,
          isHighlighted:               sql`EXCLUDED.is_highlighted`,
          isActive:                    sql`EXCLUDED.is_active`,
          sortOrder:                   sql`EXCLUDED.sort_order`,
          updatedAt:                   sql`now()`,
        },
      });
    console.log(`  ✓ ${plan.displayName} (${plan.tier})`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
