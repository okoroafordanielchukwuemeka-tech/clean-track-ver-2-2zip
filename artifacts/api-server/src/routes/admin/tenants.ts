import { Router } from "express";
import { db } from "@workspace/db";
import { laundries, branches, workers, orders, deviceHeartbeats, alerts, schemaSnapshots } from "@workspace/db/schema";
import { eq, and, gte, sql, count, desc } from "drizzle-orm";

export const adminTenantsRouter = Router();

adminTenantsRouter.get("/", async (_req, res) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

    const allLaundries = await db.select().from(laundries).orderBy(desc(laundries.createdAt));

    const tenantData = await Promise.all(allLaundries.map(async (l) => {
      const [
        [{ branchCount }],
        [{ workerCount }],
        [{ orderCount7d }],
        [{ orderCountTotal }],
        [{ deviceCount }],
        [{ onlineDevices }],
        [{ openAlerts }],
        [{ criticalAlerts }],
        latestSnapshot,
      ] = await Promise.all([
        db.select({ branchCount: count() }).from(branches).where(eq(branches.laundryId, l.id)),
        db.select({ workerCount: count() }).from(workers)
          .where(and(eq(workers.laundryId, l.id), eq(workers.isActive, true))),
        db.select({ orderCount7d: count() }).from(orders)
          .where(and(eq(orders.laundryId, l.id), gte(orders.createdAt, sevenDaysAgo))),
        db.select({ orderCountTotal: count() }).from(orders).where(eq(orders.laundryId, l.id)),
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

      return {
        ...safeLaundry,
        stats: {
          branches: Number(branchCount),
          workers: Number(workerCount),
          orders7d: Number(orderCount7d),
          ordersTotal: Number(orderCountTotal),
          devices: Number(deviceCount),
          onlineDevices: Number(onlineDevices),
          openAlerts: Number(openAlerts),
          criticalAlerts: Number(criticalAlerts),
          lastSnapshotAt: latestSnapshot[0]?.createdAt ?? null,
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
    if (isNaN(id)) return res.status(400).json({ error: "Invalid tenant ID" });

    const [laundry] = await db.select().from(laundries).where(eq(laundries.id, id));
    if (!laundry) return res.status(404).json({ error: "Tenant not found" });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [recentOrders, devices, openAlerts, snapshots] = await Promise.all([
      db.select({
        id: orders.id,
        status: orders.status,
        createdAt: orders.createdAt,
      }).from(orders)
        .where(and(eq(orders.laundryId, id), gte(orders.createdAt, thirtyDaysAgo)))
        .orderBy(desc(orders.createdAt))
        .limit(10),
      db.select().from(deviceHeartbeats).where(eq(deviceHeartbeats.laundryId, id)),
      db.select().from(alerts)
        .where(and(eq(alerts.laundryId, id), eq(alerts.status, "open")))
        .orderBy(desc(alerts.createdAt)),
      db.select().from(schemaSnapshots)
        .where(sql`${schemaSnapshots.triggeredBy} LIKE ${`laundry:${id}%`}`)
        .orderBy(desc(schemaSnapshots.createdAt))
        .limit(10),
    ]);

    const { passwordHash: _ph, ...safeLaundry } = laundry;

    res.json({
      tenant: safeLaundry,
      recentOrders,
      devices,
      openAlerts,
      snapshots,
    });
  } catch (err) {
    console.error("Admin tenant detail error:", err);
    res.status(500).json({ error: "Failed to fetch tenant detail" });
  }
});
