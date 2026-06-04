import { Router } from "express";
import { db } from "@workspace/db";
import { deviceHeartbeats } from "@workspace/db/schema";
import { AuthRequest } from "../middleware/auth.js";

export const telemetryRouter = Router();

/**
 * POST /api/telemetry/heartbeat
 *
 * Workers and owners send this every 30 seconds. The server upserts one row
 * per (laundry_id, device_id) — so each physical device has exactly one row
 * that is overwritten on every beat.
 *
 * Payload fields come from the client's local sync engine state:
 *   deviceId       — UUID generated once per browser profile (localStorage)
 *   pendingCount   — items waiting to sync
 *   failedCount    — items permanently failed (status = "failed")
 *   conflictCount  — subset of failed: CONFLICT: prefixed errors
 *   recoveryCount  — orphans rebuilt by the startup recovery pass
 *   isOnline       — navigator.onLine at the time of the beat
 *   appVersion     — static string baked in at build time
 *   lastSyncedAt   — ISO timestamp of the last successful sync cycle
 *
 * Identity fields are derived from the JWT (never trusted from the body).
 */
telemetryRouter.post("/heartbeat", async (req: AuthRequest, res) => {
  try {
    const auth = req.auth!;
    const body = req.body as Record<string, unknown>;

    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const toInt = (v: unknown) => {
      const n = parseInt(v as string);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    const values = {
      laundryId: auth.laundryId,
      branchId: auth.branchId ?? null,
      workerId: auth.workerId ?? null,
      actorType: auth.type as "owner" | "worker",
      workerName: auth.name ?? null,
      deviceId,
      pendingCount: toInt(body.pendingCount),
      failedCount: toInt(body.failedCount),
      conflictCount: toInt(body.conflictCount),
      recoveryCount: toInt(body.recoveryCount),
      isOnline: body.isOnline !== false,
      appVersion: typeof body.appVersion === "string" ? body.appVersion : null,
      lastSyncedAt:
        typeof body.lastSyncedAt === "string" && body.lastSyncedAt
          ? new Date(body.lastSyncedAt)
          : null,
      lastSeenAt: new Date(),
    };

    await db
      .insert(deviceHeartbeats)
      .values(values)
      .onConflictDoUpdate({
        target: [deviceHeartbeats.laundryId, deviceHeartbeats.deviceId],
        set: {
          branchId: values.branchId,
          workerId: values.workerId,
          actorType: values.actorType,
          workerName: values.workerName,
          pendingCount: values.pendingCount,
          failedCount: values.failedCount,
          conflictCount: values.conflictCount,
          recoveryCount: values.recoveryCount,
          isOnline: values.isOnline,
          appVersion: values.appVersion,
          lastSyncedAt: values.lastSyncedAt,
          lastSeenAt: values.lastSeenAt,
        },
      });

    return res.status(204).end();
  } catch (err) {
    console.error("[CleanTrack] Telemetry heartbeat error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
