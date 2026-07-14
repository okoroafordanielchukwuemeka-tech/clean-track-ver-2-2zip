/**
 * Seed the plans table with the canonical CleanTrack plan definitions.
 *
 * Run with: pnpm tsx scripts/seed-plans.ts
 *
 * This is idempotent — uses ON CONFLICT DO NOTHING, so safe to run multiple times.
 */

import { db } from "@workspace/db";
import { plans } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

const PLAN_ROWS = [
  {
    tier: "free",
    displayName: "Free",
    priceMonthlyNgn: 0,
    maxOrdersPerMonth: 30,
    maxWorkers: 1,
    maxBranches: 1,
    maxCustomers: 50,
    maxStorageMb: 100,
    features: JSON.stringify({
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
    }),
    isActive: true,
  },
  {
    tier: "starter",
    displayName: "Starter",
    priceMonthlyNgn: 10_000,
    maxOrdersPerMonth: 500,
    maxWorkers: 2,
    maxBranches: 1,
    maxCustomers: 500,
    maxStorageMb: 500,
    features: JSON.stringify({
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
    }),
    isActive: true,
  },
  {
    tier: "pro",
    displayName: "Professional",
    priceMonthlyNgn: 20_000,
    maxOrdersPerMonth: -1,   // -1 = unlimited
    maxWorkers: 15,
    maxBranches: 5,
    maxCustomers: 5_000,
    maxStorageMb: 5_000,
    features: JSON.stringify({
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
    }),
    isActive: true,
  },
  {
    tier: "business",
    displayName: "Enterprise",
    priceMonthlyNgn: 50_000,
    maxOrdersPerMonth: -1,
    maxWorkers: -1,
    maxBranches: -1,
    maxCustomers: -1,
    maxStorageMb: 50_000,
    features: JSON.stringify({
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
    }),
    isActive: true,
  },
];

async function main() {
  console.log("Seeding plans table…");

  for (const plan of PLAN_ROWS) {
    await db
      .insert(plans)
      .values(plan)
      .onConflictDoNothing();
    console.log(`  ✓ ${plan.displayName} (${plan.tier})`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
