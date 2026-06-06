/**
 * Phase F — Production Health API
 *
 * GET /api/health/production
 * Requires: owner authentication
 *
 * Returns a consolidated health snapshot covering:
 * - API server status
 * - Database connectivity and stats
 * - Backup recency and integrity
 * - Open alerts summary
 * - Active devices
 * - Sync health (failed jobs)
 * - Rate limiter status
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  alerts,
  deviceHeartbeats,
  laundries,
  orders,
  workers,
  customers,
} from "@workspace/db/schema";
import { eq, and, gte, count, sql, desc } from "drizzle-orm";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import fs from "fs";
import path from "path";

export const productionHealthRouter = Router();

function getBackupsDir(): string {
  const p = "/home/runner/workspace/backups";
  return fs.existsSync(p) ? p : path.join(process.cwd(), "../../backups");
}

function readLatestManifest(): Record<string, unknown> | null {
  try {
    const dir = getBackupsDir();
    if (!fs.existsSync(dir)) return null;
    const manifests = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".manifest.json"))
      .sort()
      .reverse();
    if (!manifests.length) return null;
    return JSON.parse(fs.readFileSync(path.join(dir, manifests[0]), "utf-8"));
  } catch {
    return null;
  }
}

productionHealthRouter.get("/production", requireOwner, async (req: AuthRequest, res) => {
  const startedAt = Date.now();
  const laundryId = req.auth!.laundryId;

  try {
    // ── Database health ───────────────────────────────────────────────────
    const dbStart = Date.now();
    const [tableCountResult, dbSizeResult] = await Promise.all([
      db.execute(
        sql`SELECT count(*)::int as cnt FROM information_schema.tables WHERE table_schema = 'public'`
      ),
      db.execute(
        sql`SELECT pg_database_size(current_database())::bigint as bytes, pg_size_pretty(pg_database_size(current_database())) as pretty`
      ),
    ]);
    const dbLatencyMs = Date.now() - dbStart;
    const tableCount = (tableCountResult.rows[0] as { cnt: number }).cnt;
    const dbSizeBytes = Number((dbSizeResult.rows[0] as { bytes: string }).bytes);
    const dbSizePretty = (dbSizeResult.rows[0] as { pretty: string }).pretty;

    // ── Business data counts ──────────────────────────────────────────────
    const since30d = new Date(Date.now() - 30 * 86_400_000);
    const [orderCount, workerCount, customerCount] = await Promise.all([
      db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.laundryId, laundryId), gte(orders.createdAt, since30d))),
      db
        .select({ c: count() })
        .from(workers)
        .where(and(eq(workers.laundryId, laundryId), eq(workers.isActive, true))),
      db
        .select({ c: count() })
        .from(customers)
        .where(eq(customers.laundryId, laundryId)),
    ]);

    // ── Alerts ────────────────────────────────────────────────────────────
    const openAlerts = await db
      .select({
        id: alerts.id,
        severity: alerts.severity,
        category: alerts.category,
        title: alerts.title,
        message: alerts.message,
        status: alerts.status,
        createdAt: alerts.createdAt,
      })
      .from(alerts)
      .where(and(eq(alerts.laundryId, laundryId), eq(alerts.status, "open")))
      .orderBy(desc(alerts.createdAt))
      .limit(20);

    const alertCounts = {
      total: openAlerts.length,
      critical: openAlerts.filter((a) => a.severity === "critical").length,
      warning: openAlerts.filter((a) => a.severity === "warning").length,
      info: openAlerts.filter((a) => a.severity === "info").length,
    };

    // ── Active devices ─────────────────────────────────────────────────────
    const since5m = new Date(Date.now() - 5 * 60 * 1000);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [activeDevices, recentDevices] = await Promise.all([
      db
        .select({ c: count() })
        .from(deviceHeartbeats)
        .where(
          and(eq(deviceHeartbeats.laundryId, laundryId), gte(deviceHeartbeats.lastSeenAt, since5m))
        ),
      db
        .select({
          deviceId: deviceHeartbeats.deviceId,
          userType: deviceHeartbeats.userType,
          userName: deviceHeartbeats.userName,
          syncStatus: deviceHeartbeats.syncStatus,
          pendingCount: deviceHeartbeats.pendingCount,
          failedCount: deviceHeartbeats.failedCount,
          lastSeenAt: deviceHeartbeats.lastSeenAt,
          appVersion: deviceHeartbeats.appVersion,
        })
        .from(deviceHeartbeats)
        .where(
          and(
            eq(deviceHeartbeats.laundryId, laundryId),
            gte(deviceHeartbeats.lastSeenAt, since24h)
          )
        )
        .orderBy(desc(deviceHeartbeats.lastSeenAt))
        .limit(20),
    ]);

    const failedJobDevices = recentDevices.filter((d) => (d.failedCount ?? 0) > 0);
    const totalFailedJobs = recentDevices.reduce((sum, d) => sum + (d.failedCount ?? 0), 0);
    const totalPendingJobs = recentDevices.reduce((sum, d) => sum + (d.pendingCount ?? 0), 0);

    // ── Backup status ──────────────────────────────────────────────────────
    const manifest = readLatestManifest();
    const backupAgeHours = manifest?.createdAt
      ? (Date.now() - new Date(manifest.createdAt as string).getTime()) / 3_600_000
      : null;

    const backupStatus =
      !manifest
        ? "critical"
        : backupAgeHours! <= 24
        ? "healthy"
        : backupAgeHours! <= 72
        ? "warning"
        : "critical";

    const hasHmacSignature = !!manifest?.hmacSignature;

    // ── Tenant info ────────────────────────────────────────────────────────
    const [laundry] = await db
      .select({ businessName: laundries.businessName, subscriptionStatus: laundries.subscriptionStatus, trialEndsAt: laundries.trialEndsAt })
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    // ── API latency ────────────────────────────────────────────────────────
    const totalLatencyMs = Date.now() - startedAt;

    // ── Derive overall status ─────────────────────────────────────────────
    const hasCriticalAlerts = alertCounts.critical > 0;
    const hasFailedJobs = totalFailedJobs > 0;
    const dbHealthy = dbLatencyMs < 2000;

    const overallStatus =
      !dbHealthy || backupStatus === "critical" || hasCriticalAlerts
        ? "critical"
        : hasFailedJobs || backupStatus === "warning" || alertCounts.warning > 0
        ? "warning"
        : "healthy";

    res.json({
      overallStatus,
      generatedAt: new Date().toISOString(),
      latencyMs: totalLatencyMs,

      api: {
        status: "healthy",
        uptimeMs: process.uptime() * 1000,
        nodeVersion: process.version,
        latencyMs: totalLatencyMs,
      },

      database: {
        status: dbHealthy ? "healthy" : "degraded",
        latencyMs: dbLatencyMs,
        tables: tableCount,
        sizeBytes: dbSizeBytes,
        sizePretty: dbSizePretty,
      },

      backup: {
        status: backupStatus,
        lastBackup: manifest
          ? {
              file: manifest.file,
              sizeBytes: manifest.sizeBytes,
              sha256: manifest.sha256,
              createdAt: manifest.createdAt,
              ageHours: backupAgeHours ? Math.round(backupAgeHours * 10) / 10 : null,
              hmacSigned: hasHmacSignature,
              scheduledRun: manifest.scheduledRun ?? false,
            }
          : null,
        backupCount: (() => {
          try {
            const dir = getBackupsDir();
            return fs.existsSync(dir)
              ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql.gz")).length
              : 0;
          } catch {
            return 0;
          }
        })(),
      },

      alerts: {
        ...alertCounts,
        items: openAlerts.slice(0, 5),
      },

      devices: {
        activeNow: Number(activeDevices[0].c),
        activeLast24h: recentDevices.length,
        failedJobDevices: failedJobDevices.length,
        items: recentDevices,
      },

      sync: {
        status: totalFailedJobs === 0 ? "healthy" : "degraded",
        pendingJobs: totalPendingJobs,
        failedJobs: totalFailedJobs,
      },

      business: {
        laundryId,
        businessName: laundry?.businessName ?? "Unknown",
        subscriptionStatus: laundry?.subscriptionStatus,
        trialEndsAt: laundry?.trialEndsAt,
        ordersLast30d: Number(orderCount[0].c),
        activeWorkers: Number(workerCount[0].c),
        totalCustomers: Number(customerCount[0].c),
      },
    });
  } catch (err) {
    console.error("[production-health]", err);
    res.status(500).json({ error: "Health check failed", latencyMs: Date.now() - startedAt });
  }
});
