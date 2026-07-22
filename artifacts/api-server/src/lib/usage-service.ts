import { db } from "@workspace/db";
import { orders, workers, branches, customers, plans, whatsappActivityLogs } from "@workspace/db/schema";
import { eq, and, gte, isNull, count } from "drizzle-orm";
import { getPlanLimits } from "./entitlements.js";

/**
 * Resolves plan capacity limits from the plans DB table.
 * Falls back to hardcoded entitlements.ts constants if the tier isn't found in DB.
 * This makes limits fully database-driven: update the plans table to change limits
 * without a code deploy.
 */
async function getPlanLimitsFromDb(plan: string): Promise<{
  maxBranches: number;
  maxWorkers: number;
  maxOrdersPerMonth: number;
  maxCustomers: number;
  maxStorageMb: number;
  maxWhatsappMessagesPerMonth: number;
  maxAiCreditsPerMonth: number;
}> {
  const [row] = await db
    .select({
      maxBranches: plans.maxBranches,
      maxWorkers: plans.maxWorkers,
      maxOrdersPerMonth: plans.maxOrdersPerMonth,
      maxCustomers: plans.maxCustomers,
      maxStorageMb: plans.maxStorageMb,
      maxWhatsappMessagesPerMonth: plans.maxWhatsappMessagesPerMonth,
      maxAiCreditsPerMonth: plans.maxAiCreditsPerMonth,
    })
    .from(plans)
    .where(eq(plans.tier, plan));

  // null in DB means unlimited → Infinity in code
  const toNum = (v: number | null | undefined, fallback: number) =>
    v === null || v === undefined ? fallback : v < 0 ? Infinity : v;

  if (row) {
    const codeLimits = getPlanLimits(plan);
    return {
      maxBranches:                 toNum(row.maxBranches,                 codeLimits.maxBranches),
      maxWorkers:                  toNum(row.maxWorkers,                  codeLimits.maxWorkers),
      maxOrdersPerMonth:           toNum(row.maxOrdersPerMonth,           codeLimits.maxOrdersPerMonth),
      maxCustomers:                toNum(row.maxCustomers,                codeLimits.maxCustomers),
      maxStorageMb:                toNum(row.maxStorageMb,                5120),
      maxWhatsappMessagesPerMonth: toNum(row.maxWhatsappMessagesPerMonth, codeLimits.maxWhatsappMessagesPerMonth),
      maxAiCreditsPerMonth:        toNum(row.maxAiCreditsPerMonth,        codeLimits.maxAiCreditsPerMonth),
    };
  }

  // Fallback to code constants when plan not found in DB
  const codeLimits = getPlanLimits(plan);
  return {
    ...codeLimits,
    maxStorageMb: MAX_STORAGE_MB_BY_PLAN[plan] ?? 5120,
  };
}

/**
 * Hardcoded storage fallback only used when the DB plans table has no maxStorageMb.
 * Spec values: Starter = 5 GB, Professional = 25 GB, Enterprise = unlimited.
 */
export const MAX_STORAGE_MB_BY_PLAN: Record<string, number> = {
  free:     512,
  starter:  5_120,   // 5 GB
  pro:      25_600,  // 25 GB
  business: Infinity,
};

export interface UsageSnapshot {
  monthlyOrderCount: number;
  activeWorkerCount: number;
  activeBranchCount: number;
  activeCustomerCount: number;
  storageUsedMb: number;
  monthlyWhatsappMessageCount: number;
  monthlyAiCreditCount: number;
}

export type UsageWarningLevel = "safe" | "warning_70" | "warning_85" | "critical_100";

export interface UsageWithLimits extends UsageSnapshot {
  plan: string;
  limits: {
    maxOrdersPerMonth: number;
    maxWorkers: number;
    maxBranches: number;
    maxCustomers: number;
    maxStorageMb: number;
    maxWhatsappMessagesPerMonth: number;
    maxAiCreditsPerMonth: number;
  };
  percentages: {
    orders: number;
    workers: number;
    branches: number;
    customers: number;
    storage: number;
    whatsappMessages: number;
    aiCredits: number;
  };
  warnings: {
    orders: UsageWarningLevel;
    workers: UsageWarningLevel;
    branches: UsageWarningLevel;
    customers: UsageWarningLevel;
    storage: UsageWarningLevel;
    whatsappMessages: UsageWarningLevel;
    aiCredits: UsageWarningLevel;
  };
}

function getWarningLevel(pct: number): UsageWarningLevel {
  if (pct >= 100) return "critical_100";
  if (pct >= 85) return "warning_85";
  if (pct >= 70) return "warning_70";
  return "safe";
}

function calcPct(used: number, limit: number): number {
  if (!isFinite(limit) || limit <= 0) return 0;
  return Math.round((used / limit) * 100);
}

/**
 * Computes current usage from DB truth for a given laundry.
 * Self-healing: always reads fresh from the authoritative source tables.
 * Multi-tenant safe: all queries are scoped by laundryId.
 */
export async function computeUsage(laundryId: number): Promise<UsageSnapshot> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    [{ monthlyOrders }],
    [{ activeWorkers }],
    [{ activeBranches }],
    [{ activeCustomers }],
    [{ totalOrders }],
    whatsappResult,
  ] = await Promise.all([
    db.select({ monthlyOrders: count() })
      .from(orders)
      .where(and(eq(orders.laundryId, laundryId), gte(orders.createdAt, monthStart))),
    db.select({ activeWorkers: count() })
      .from(workers)
      .where(and(eq(workers.laundryId, laundryId), eq(workers.isActive, true), isNull(workers.deletedAt))),
    db.select({ activeBranches: count() })
      .from(branches)
      .where(and(eq(branches.laundryId, laundryId), isNull(branches.deletedAt))),
    db.select({ activeCustomers: count() })
      .from(customers)
      .where(and(eq(customers.laundryId, laundryId), isNull(customers.deletedAt))),
    db.select({ totalOrders: count() })
      .from(orders)
      .where(eq(orders.laundryId, laundryId)),
    // Count outbound WhatsApp messages sent this month (action = MESSAGE_SENT)
    db.select({ cnt: count() })
      .from(whatsappActivityLogs)
      .where(
        and(
          eq(whatsappActivityLogs.laundryId, laundryId),
          eq(whatsappActivityLogs.action, "MESSAGE_SENT"),
          gte(whatsappActivityLogs.createdAt, monthStart)
        )
      )
      .catch(() => [{ cnt: 0 }]),
  ]);

  // Storage estimate: ~2 KB per order (row + items + payment records combined)
  const storageUsedMb = Math.round((Number(totalOrders) * 2) / 1024 * 10) / 10;

  const monthlyWhatsappMessageCount = Number(
    Array.isArray(whatsappResult) && whatsappResult[0] ? (whatsappResult[0] as any).cnt : 0
  );

  return {
    monthlyOrderCount: Number(monthlyOrders),
    activeWorkerCount: Number(activeWorkers),
    activeBranchCount: Number(activeBranches),
    activeCustomerCount: Number(activeCustomers),
    storageUsedMb,
    monthlyWhatsappMessageCount,
    monthlyAiCreditCount: 0, // AI credit tracking — infrastructure ready; counted when AI features go live
  };
}

/**
 * Computes usage enriched with plan limits and warning levels.
 * Reads limits from the plans DB table (DB-driven). Falls back to
 * hardcoded entitlements.ts constants if the plan is not found in the DB.
 */
export async function computeUsageWithLimits(laundryId: number, plan: string): Promise<UsageWithLimits> {
  const [usage, limits] = await Promise.all([
    computeUsage(laundryId),
    getPlanLimitsFromDb(plan),
  ]);

  const pctOrders    = calcPct(usage.monthlyOrderCount,          limits.maxOrdersPerMonth);
  const pctWorkers   = calcPct(usage.activeWorkerCount,           limits.maxWorkers);
  const pctBranches  = calcPct(usage.activeBranchCount,           limits.maxBranches);
  const pctCustomers = calcPct(usage.activeCustomerCount,         limits.maxCustomers);
  const pctStorage   = calcPct(usage.storageUsedMb,              limits.maxStorageMb);
  const pctWa        = calcPct(usage.monthlyWhatsappMessageCount, limits.maxWhatsappMessagesPerMonth);
  const pctAi        = calcPct(usage.monthlyAiCreditCount,        limits.maxAiCreditsPerMonth);

  return {
    ...usage,
    plan,
    limits: {
      maxOrdersPerMonth:           limits.maxOrdersPerMonth,
      maxWorkers:                  limits.maxWorkers,
      maxBranches:                 limits.maxBranches,
      maxCustomers:                limits.maxCustomers,
      maxStorageMb:                limits.maxStorageMb,
      maxWhatsappMessagesPerMonth: limits.maxWhatsappMessagesPerMonth,
      maxAiCreditsPerMonth:        limits.maxAiCreditsPerMonth,
    },
    percentages: {
      orders:          pctOrders,
      workers:         pctWorkers,
      branches:        pctBranches,
      customers:       pctCustomers,
      storage:         pctStorage,
      whatsappMessages: pctWa,
      aiCredits:       pctAi,
    },
    warnings: {
      orders:          getWarningLevel(pctOrders),
      workers:         getWarningLevel(pctWorkers),
      branches:        getWarningLevel(pctBranches),
      customers:       getWarningLevel(pctCustomers),
      storage:         getWarningLevel(pctStorage),
      whatsappMessages: getWarningLevel(pctWa),
      aiCredits:       getWarningLevel(pctAi),
    },
  };
}

/**
 * Hard limit check before resource creation.
 * Reads limits from the plans DB table — fully DB-driven enforcement.
 * Returns null if within limits, or { code, message } if exceeded.
 * Multi-tenant safe: scoped by laundryId.
 */
export async function checkLimit(
  laundryId: number,
  plan: string,
  limitType: "orders" | "workers" | "branches" | "customers"
): Promise<{ code: string; message: string } | null> {
  // Read limits from DB — not hardcoded
  const limits = await getPlanLimitsFromDb(plan);

  if (limitType === "orders") {
    const max = limits.maxOrdersPerMonth;
    if (!isFinite(max)) return null;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [{ cnt }] = await db.select({ cnt: count() })
      .from(orders)
      .where(and(eq(orders.laundryId, laundryId), gte(orders.createdAt, monthStart)));
    if (Number(cnt) >= max) {
      return {
        code: "PLAN_LIMIT_ORDERS_REACHED",
        message: `Your plan allows ${max} orders per month. You have reached this limit. Upgrade your plan to create more orders.`,
      };
    }
  }

  if (limitType === "workers") {
    const max = limits.maxWorkers;
    if (!isFinite(max)) return null;
    const [{ cnt }] = await db.select({ cnt: count() })
      .from(workers)
      .where(and(eq(workers.laundryId, laundryId), eq(workers.isActive, true), isNull(workers.deletedAt)));
    if (Number(cnt) >= max) {
      return {
        code: "PLAN_LIMIT_WORKERS_REACHED",
        message: `Your plan allows ${max} active worker${max === 1 ? "" : "s"}. You have reached this limit. Upgrade your plan to add more workers.`,
      };
    }
  }

  if (limitType === "branches") {
    const max = limits.maxBranches;
    if (!isFinite(max)) return null;
    const [{ cnt }] = await db.select({ cnt: count() })
      .from(branches)
      .where(and(eq(branches.laundryId, laundryId), isNull(branches.deletedAt)));
    if (Number(cnt) >= max) {
      return {
        code: "PLAN_LIMIT_BRANCHES_REACHED",
        message: `Your plan allows ${max} branch${max === 1 ? "" : "es"}. You have reached this limit. Upgrade your plan to add more branches.`,
      };
    }
  }

  if (limitType === "customers") {
    const max = limits.maxCustomers;
    if (!isFinite(max)) return null;
    const [{ cnt }] = await db.select({ cnt: count() })
      .from(customers)
      .where(and(eq(customers.laundryId, laundryId), isNull(customers.deletedAt)));
    if (Number(cnt) >= max) {
      return {
        code: "PLAN_LIMIT_CUSTOMERS_REACHED",
        message: `Your plan allows ${max} active customers. You have reached this limit. Upgrade your plan to add more customers.`,
      };
    }
  }

  return null;
}
