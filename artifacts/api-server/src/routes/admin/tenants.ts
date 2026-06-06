import { Router } from "express";
import { db } from "@workspace/db";
import { laundries, branches, workers, orders, deviceHeartbeats, alerts, schemaSnapshots } from "@workspace/db/schema";
import { eq, and, gte, sql, count, desc, isNull } from "drizzle-orm";
import { getPlanLimits, PLAN_DISPLAY_NAMES } from "../../lib/entitlements.js";
import { MAX_STORAGE_MB_BY_PLAN } from "../../lib/usage-service.js";

export const adminTenantsRouter = Router();

function calcPct(used: number, limit: number): number {
  if (!isFinite(limit) || limit <= 0) return 0;
  return Math.round((used / limit) * 100);
}

adminTenantsRouter.get("/", async (_req, res) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const allLaundries = await db.select().from(laundries).orderBy(desc(laundries.createdAt));

    const tenantData = await Promise.all(allLaundries.map(async (l) => {
      const plan = l.subscriptionTier;
      const planLimits = getPlanLimits(plan);
      const maxStorageMb = MAX_STORAGE_MB_BY_PLAN[plan] ?? 500;

      const [
        [{ branchCount }],
        [{ workerCount }],
        [{ orderCount7d }],
        [{ orderCountTotal }],
        [{ monthlyOrders }],
        [{ deviceCount }],
        [{ onlineDevices }],
        [{ openAlerts }],
        [{ criticalAlerts }],
        latestSnapshot,
      ] = await Promise.all([
        db.select({ branchCount: count() }).from(branches)
          .where(and(eq(branches.laundryId, l.id), isNull(branches.deletedAt))),
        db.select({ workerCount: count() }).from(workers)
          .where(and(eq(workers.laundryId, l.id), eq(workers.isActive, true), isNull(workers.deletedAt))),
        db.select({ orderCount7d: count() }).from(orders)
          .where(and(eq(orders.laundryId, l.id), gte(orders.createdAt, sevenDaysAgo))),
        db.select({ orderCountTotal: count() }).from(orders).where(eq(orders.laundryId, l.id)),
        db.select({ monthlyOrders: count() }).from(orders)
          .where(and(eq(orders.laundryId, l.id), gte(orders.createdAt, monthStart))),
        db.select({ deviceCount: count() }).from(deviceHeartbeats)
          .where(eq(deviceHeartbeats.laundryId, l.id)),
        db.select({ onlineDevices: count() }).from(deviceHeartbeats)
          .where(and(
            eq(deviceHeartbeats.laundryId, l.id),
            gte(deviceHeartbeats.lastSeenAt, thirtyMinAgo)
          )),
        db.select({ openAlerts: count() }).from(alerts)
          .where(and(eq(alerts.laundryId, l.id), eq(alerts.status, "open"))),
        db.select({ criticalAlerts: count() }).from(alerts)
          .where(and(
            eq(alerts.laundryId, l.id),
            eq(alerts.status, "open"),
            eq(alerts.severity, "critical")
          )),
        db.select().from(schemaSnapshots)
          .where(sql`${schemaSnapshots.triggeredBy} LIKE ${`laundry:${l.id}%`}`)
          .orderBy(desc(schemaSnapshots.createdAt))
          .limit(1),
      ]);

      const { passwordHash: _ph, ...safeLaundry } = l;

      const branchCnt = Number(branchCount);
      const workerCnt = Number(workerCount);
      const monthlyCnt = Number(monthlyOrders);
      const totalCnt = Number(orderCountTotal);
      const storageEst = Math.round((totalCnt * 2) / 1024 * 10) / 10;

      const pctOrders = calcPct(monthlyCnt, planLimits.maxOrdersPerMonth);
      const pctWorkers = calcPct(workerCnt, planLimits.maxWorkers);
      const pctBranches = calcPct(branchCnt, planLimits.maxBranches);
      const pctStorage = calcPct(storageEst, maxStorageMb);

      const highestPct = Math.max(pctOrders, pctWorkers, pctBranches, pctStorage);

      return {
        ...safeLaundry,
        planDisplayName: (PLAN_DISPLAY_NAMES as any)[plan] ?? plan,
        stats: {
          branches: branchCnt,
          workers: workerCnt,
          orders7d: Number(orderCount7d),
          ordersTotal: totalCnt,
          monthlyOrders: monthlyCnt,
          devices: Number(deviceCount),
          onlineDevices: Number(onlineDevices),
          openAlerts: Number(openAlerts),
          criticalAlerts: Number(criticalAlerts),
          lastSnapshotAt: latestSnapshot[0]?.createdAt ?? null,
          storageUsedMb: storageEst,
        },
        usage: {
          percentages: { orders: pctOrders, workers: pctWorkers, branches: pctBranches, storage: pctStorage },
          highestPct,
          limits: {
            maxOrdersPerMonth: planLimits.maxOrdersPerMonth,
            maxWorkers: planLimits.maxWorkers,
            maxBranches: planLimits.maxBranches,
            maxStorageMb: maxStorageMb,
          },
        },
      };
    }));

    res.json({ tenants: tenantData, total: tenantData.length });
  } catch (err) {
    console.error("Admin tenants error:", err);
    res.status(500).json({ error: "Failed to fetch tenant data" });
  }
});

adminTenantsRouter.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const now = new Date();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [laundry] = await db.select().from(laundries).where(eq(laundries.id, id));
    if (!laundry) return res.status(404).json({ error: "Tenant not found" });

    const plan = laundry.subscriptionTier;
    const planLimits = getPlanLimits(plan);
    const maxStorageMb = MAX_STORAGE_MB_BY_PLAN[plan] ?? 500;

    const [
      [{ branchCount }],
      [{ workerCount }],
      [{ orderCount }],
      [{ monthlyOrders }],
      heartbeats,
    ] = await Promise.all([
      db.select({ branchCount: count() }).from(branches)
        .where(and(eq(branches.laundryId, id), isNull(branches.deletedAt))),
      db.select({ workerCount: count() }).from(workers)
        .where(and(eq(workers.laundryId, id), eq(workers.isActive, true), isNull(workers.deletedAt))),
      db.select({ orderCount: count() }).from(orders).where(eq(orders.laundryId, id)),
      db.select({ monthlyOrders: count() }).from(orders)
        .where(and(eq(orders.laundryId, id), gte(orders.createdAt, monthStart))),
      db.select().from(deviceHeartbeats).where(eq(deviceHeartbeats.laundryId, id)),
    ]);

    const { passwordHash: _ph, ...safeLaundry } = laundry;
    const branchCnt = Number(branchCount);
    const workerCnt = Number(workerCount);
    const totalCnt = Number(orderCount);
    const monthlyCnt = Number(monthlyOrders);
    const storageEst = Math.round((totalCnt * 2) / 1024 * 10) / 10;

    res.json({
      laundry: safeLaundry,
      planDisplayName: (PLAN_DISPLAY_NAMES as any)[plan] ?? plan,
      stats: {
        branches: branchCnt,
        workers: workerCnt,
        ordersTotal: totalCnt,
        monthlyOrders: monthlyCnt,
        storageUsedMb: storageEst,
        devices: heartbeats.length,
        onlineDevices: heartbeats.filter(d => (now.getTime() - new Date(d.lastSeenAt).getTime()) < 30 * 60 * 1000).length,
      },
      usage: {
        percentages: {
          orders: calcPct(monthlyCnt, planLimits.maxOrdersPerMonth),
          workers: calcPct(workerCnt, planLimits.maxWorkers),
          branches: calcPct(branchCnt, planLimits.maxBranches),
          storage: calcPct(storageEst, maxStorageMb),
        },
        limits: {
          maxOrdersPerMonth: planLimits.maxOrdersPerMonth,
          maxWorkers: planLimits.maxWorkers,
          maxBranches: planLimits.maxBranches,
          maxStorageMb,
        },
      },
      devices: heartbeats,
    });
  } catch (err) {
    console.error("Admin tenant detail error:", err);
    res.status(500).json({ error: "Failed to fetch tenant" });
  }
});
