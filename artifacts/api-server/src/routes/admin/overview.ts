import { Router } from "express";
import { db } from "@workspace/db";
import { laundries, branches, workers, orders, deviceHeartbeats, alerts, schemaSnapshots } from "@workspace/db/schema";
import { eq, and, gte, sql, count, lt } from "drizzle-orm";

export const adminOverviewRouter = Router();

adminOverviewRouter.get("/", async (_req, res) => {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      [{ totalTenants }],
      [{ activeTenants }],
      [{ totalBranches }],
      [{ totalWorkers }],
      [{ totalOrders }],
      [{ ordersThisWeek }],
      [{ totalDevices }],
      [{ onlineDevices }],
      [{ staleDevices }],
      [{ offlineDevices }],
      [{ openAlerts }],
      [{ criticalAlerts }],
    ] = await Promise.all([
      db.select({ totalTenants: count() }).from(laundries),
      db.select({ activeTenants: count() }).from(laundries).where(eq(laundries.isActive, true)),
      db.select({ totalBranches: count() }).from(branches),
      db.select({ totalWorkers: count() }).from(workers).where(eq(workers.isActive, true)),
      db.select({ totalOrders: count() }).from(orders),
      db.select({ ordersThisWeek: count() }).from(orders).where(gte(orders.createdAt, sevenDaysAgo)),
      db.select({ totalDevices: count() }).from(deviceHeartbeats),
      db.select({ onlineDevices: count() }).from(deviceHeartbeats)
        .where(gte(deviceHeartbeats.lastSeenAt, thirtyMinAgo)),
      db.select({ staleDevices: count() }).from(deviceHeartbeats)
        .where(and(
          lt(deviceHeartbeats.lastSeenAt, thirtyMinAgo),
          gte(deviceHeartbeats.lastSeenAt, yesterday)
        )),
      db.select({ offlineDevices: count() }).from(deviceHeartbeats)
        .where(lt(deviceHeartbeats.lastSeenAt, yesterday)),
      db.select({ openAlerts: count() }).from(alerts).where(eq(alerts.status, "open")),
      db.select({ criticalAlerts: count() }).from(alerts)
        .where(and(eq(alerts.status, "open"), eq(alerts.severity, "critical"))),
    ]);

    // Tenants with critical open alerts
    const criticalAlertTenants = await db
      .selectDistinct({ laundryId: alerts.laundryId })
      .from(alerts)
      .where(and(eq(alerts.status, "open"), eq(alerts.severity, "critical")));

    // DB size via db.execute (returns QueryResult with .rows)
    const dbSizeResult = await db.execute(
      sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size, pg_database_size(current_database())::bigint AS db_size_bytes`
    );
    const dbSizeRow = dbSizeResult.rows[0] as { db_size: string; db_size_bytes: string } | undefined;

    res.json({
      tenants: {
        total: Number(totalTenants),
        active: Number(activeTenants),
        inactive: Number(totalTenants) - Number(activeTenants),
      },
      infrastructure: {
        branches: Number(totalBranches),
        workers: Number(totalWorkers),
      },
      orders: {
        total: Number(totalOrders),
        thisWeek: Number(ordersThisWeek),
      },
      devices: {
        total: Number(totalDevices),
        online: Number(onlineDevices),
        stale: Number(staleDevices),
        offline: Number(offlineDevices),
      },
      alerts: {
        open: Number(openAlerts),
        critical: Number(criticalAlerts),
        affectedTenants: criticalAlertTenants.length,
      },
      database: {
        sizeFormatted: dbSizeRow?.db_size ?? "unknown",
        sizeBytes: Number(dbSizeRow?.db_size_bytes ?? 0),
      },
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    console.error("Admin overview error:", err);
    res.status(500).json({ error: "Failed to fetch overview" });
  }
});
