import { Router } from "express";
import { db } from "@workspace/db";
import { laundries, schemaSnapshots } from "@workspace/db/schema";
import { eq, desc, gte, sql } from "drizzle-orm";

export const adminBackupsRouter = Router();

adminBackupsRouter.get("/", async (_req, res) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const allLaundries = await db.select({
      id: laundries.id,
      businessName: laundries.businessName,
      ownerEmail: laundries.ownerEmail,
      isActive: laundries.isActive,
      createdAt: laundries.createdAt,
    }).from(laundries).orderBy(laundries.businessName);

    const recentSnapshots = await db.select().from(schemaSnapshots)
      .orderBy(desc(schemaSnapshots.createdAt))
      .limit(100);

    const tenantBackups = allLaundries.map((l) => {
      const tenantSnaps = recentSnapshots.filter(
        (s) => s.triggeredBy && s.triggeredBy.startsWith(`laundry:${l.id}`)
      );

      const latestSnap = tenantSnaps[0] ?? null;
      const snapsIn7Days = tenantSnaps.filter(
        (s) => s.createdAt >= sevenDaysAgo
      ).length;
      const snapsIn24h = tenantSnaps.filter(
        (s) => s.createdAt >= oneDayAgo
      ).length;

      let backupHealth: "healthy" | "warning" | "critical";
      if (!latestSnap) {
        backupHealth = "critical";
      } else if (latestSnap.createdAt < sevenDaysAgo) {
        backupHealth = "critical";
      } else if (latestSnap.createdAt < oneDayAgo) {
        backupHealth = "warning";
      } else {
        backupHealth = "healthy";
      }

      return {
        laundryId: l.id,
        businessName: l.businessName,
        ownerEmail: l.ownerEmail,
        isActive: l.isActive,
        backupHealth,
        latestSnapshot: latestSnap ? {
          id: latestSnap.id,
          type: latestSnap.snapshotType,
          triggeredBy: latestSnap.triggeredBy,
          tableCount: latestSnap.tableCount,
          dbSizeBytes: latestSnap.dbSizeBytes,
          createdAt: latestSnap.createdAt,
        } : null,
        snapshotsLast7Days: snapsIn7Days,
        snapshotsLast24h: snapsIn24h,
        totalSnapshots: tenantSnaps.length,
      };
    });

    const summary = {
      total: tenantBackups.length,
      healthy: tenantBackups.filter((t) => t.backupHealth === "healthy").length,
      warning: tenantBackups.filter((t) => t.backupHealth === "warning").length,
      critical: tenantBackups.filter((t) => t.backupHealth === "critical").length,
    };

    const allSnapshots = await db.select().from(schemaSnapshots)
      .orderBy(desc(schemaSnapshots.createdAt))
      .limit(20);

    res.json({ summary, tenants: tenantBackups, recentSnapshots: allSnapshots });
  } catch (err) {
    console.error("Admin backups error:", err);
    res.status(500).json({ error: "Failed to fetch backup data" });
  }
});
