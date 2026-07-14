import { db } from "@workspace/db";
import { orders, workers, branches, customers } from "@workspace/db/schema";
import { eq, and, gte, isNull, count } from "drizzle-orm";
import { getPlanLimits } from "./entitlements.js";

export const MAX_STORAGE_MB_BY_PLAN: Record<string, number> = {
  free: 500,
  starter: 2048,
  pro: 10240,
  business: 51200,
};

export interface UsageSnapshot {
  monthlyOrderCount: number;
  activeWorkerCount: number;
  activeBranchCount: number;
  activeCustomerCount: number;
  storageUsedMb: number;
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
  };
  percentages: {
    orders: number;
    workers: number;
    branches: number;
    customers: number;
    storage: number;
  };
  warnings: {
    orders: UsageWarningLevel;
    workers: UsageWarningLevel;
    branches: UsageWarningLevel;
    customers: UsageWarningLevel;
    storage: UsageWarningLevel;
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
      .where(and(eq(customers.laundryId, laundryId), eq(customers.isActive, true))),
    db.select({ totalOrders: count() })
      .from(orders)
      .where(eq(orders.laundryId, laundryId)),
  ]);

  // Storage estimate: ~2 KB per order (row + items + payment records combined)
  const storageUsedMb = Math.round((Number(totalOrders) * 2) / 1024 * 10) / 10;

  return {
    monthlyOrderCount: Number(monthlyOrders),
    activeWorkerCount: Number(activeWorkers),
    activeBranchCount: Number(activeBranches),
    activeCustomerCount: Number(activeCustomers),
    storageUsedMb,
  };
}

/**
 * Computes usage enriched with plan limits and warning levels.
 * Recalculates from DB truth — always accurate.
 */
export async function computeUsageWithLimits(laundryId: number, plan: string): Promise<UsageWithLimits> {
  const usage = await computeUsage(laundryId);
  const limits = getPlanLimits(plan);
  const maxStorageMb = MAX_STORAGE_MB_BY_PLAN[plan] ?? 500;

  const pctOrders = calcPct(usage.monthlyOrderCount, limits.maxOrdersPerMonth);
  const pctWorkers = calcPct(usage.activeWorkerCount, limits.maxWorkers);
  const pctBranches = calcPct(usage.activeBranchCount, limits.maxBranches);
  const pctCustomers = calcPct(usage.activeCustomerCount, limits.maxCustomers);
  const pctStorage = calcPct(usage.storageUsedMb, maxStorageMb);

  return {
    ...usage,
    plan,
    limits: {
      maxOrdersPerMonth: limits.maxOrdersPerMonth,
      maxWorkers: limits.maxWorkers,
      maxBranches: limits.maxBranches,
      maxCustomers: limits.maxCustomers,
      maxStorageMb,
    },
    percentages: {
      orders: pctOrders,
      workers: pctWorkers,
      branches: pctBranches,
      customers: pctCustomers,
      storage: pctStorage,
    },
    warnings: {
      orders: getWarningLevel(pctOrders),
      workers: getWarningLevel(pctWorkers),
      branches: getWarningLevel(pctBranches),
      customers: getWarningLevel(pctCustomers),
      storage: getWarningLevel(pctStorage),
    },
  };
}

/**
 * Hard limit check before resource creation.
 * Returns null if within limits, or { code, message } if exceeded.
 * Multi-tenant safe: scoped by laundryId.
 */
export async function checkLimit(
  laundryId: number,
  plan: string,
  limitType: "orders" | "workers" | "branches" | "customers"
): Promise<{ code: string; message: string } | null> {
  const limits = getPlanLimits(plan);

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
      .where(and(eq(customers.laundryId, laundryId), eq(customers.isActive, true)));
    if (Number(cnt) >= max) {
      return {
        code: "PLAN_LIMIT_CUSTOMERS_REACHED",
        message: `Your plan allows ${max} active customers. You have reached this limit. Upgrade your plan to add more customers.`,
      };
    }
  }

  return null;
}
