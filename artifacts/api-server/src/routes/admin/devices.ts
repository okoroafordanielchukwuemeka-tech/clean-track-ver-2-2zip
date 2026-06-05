import { Router } from "express";
import { db } from "@workspace/db";
import { deviceHeartbeats, laundries, branches } from "@workspace/db/schema";
import { eq, desc, gte, lt, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const adminDevicesRouter = Router();

adminDevicesRouter.get("/", async (req, res) => {
  try {
    const now = new Date();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const laundryIdFilter = req.query.laundryId ? parseInt(req.query.laundryId as string) : null;

    const query = db
      .select({
        id: deviceHeartbeats.id,
        deviceId: deviceHeartbeats.deviceId,
        laundryId: deviceHeartbeats.laundryId,
        branchId: deviceHeartbeats.branchId,
        workerId: deviceHeartbeats.workerId,
        actorType: deviceHeartbeats.actorType,
        workerName: deviceHeartbeats.workerName,
        pendingCount: deviceHeartbeats.pendingCount,
        failedCount: deviceHeartbeats.failedCount,
        conflictCount: deviceHeartbeats.conflictCount,
        recoveryCount: deviceHeartbeats.recoveryCount,
        isOnline: deviceHeartbeats.isOnline,
        appVersion: deviceHeartbeats.appVersion,
        lastSyncedAt: deviceHeartbeats.lastSyncedAt,
        lastSeenAt: deviceHeartbeats.lastSeenAt,
        createdAt: deviceHeartbeats.createdAt,
        tenantName: laundries.businessName,
        branchName: branches.name,
      })
      .from(deviceHeartbeats)
      .leftJoin(laundries, eq(deviceHeartbeats.laundryId, laundries.id))
      .leftJoin(branches, eq(deviceHeartbeats.branchId, branches.id))
      .orderBy(desc(deviceHeartbeats.lastSeenAt));

    const rows = laundryIdFilter
      ? await query.where(eq(deviceHeartbeats.laundryId, laundryIdFilter))
      : await query;

    const devices = rows.map((d) => {
      let status: "online" | "stale" | "offline";
      const lastSeen = new Date(d.lastSeenAt);
      if (lastSeen >= thirtyMinAgo) status = "online";
      else if (lastSeen >= oneDayAgo) status = "stale";
      else status = "offline";

      return { ...d, status };
    });

    const summary = {
      total: devices.length,
      online: devices.filter((d) => d.status === "online").length,
      stale: devices.filter((d) => d.status === "stale").length,
      offline: devices.filter((d) => d.status === "offline").length,
      totalPending: devices.reduce((s, d) => s + d.pendingCount, 0),
      totalFailed: devices.reduce((s, d) => s + d.failedCount, 0),
      totalConflicts: devices.reduce((s, d) => s + d.conflictCount, 0),
    };

    res.json({ devices, summary });
  } catch (err) {
    console.error("Admin devices error:", err);
    res.status(500).json({ error: "Failed to fetch device fleet" });
  }
});
