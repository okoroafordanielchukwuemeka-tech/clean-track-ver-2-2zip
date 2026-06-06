import { db } from "@workspace/db";
import {
  alerts,
  deviceHeartbeats,
  laundries,
  schemaSnapshots,
} from "@workspace/db/schema";
import type { AlertCategory, AlertSeverity } from "@workspace/db/schema";
import { eq, and, ne, desc } from "drizzle-orm";
import fs from "fs";
import path from "path";

interface AlertInput {
  laundryId: number;
  branchId?: number | null;
  deviceId?: string | null;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  fingerprint: string;
  metadata?: Record<string, unknown>;
}

async function ensureAlert(input: AlertInput): Promise<boolean> {
  const existing = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.laundryId, input.laundryId),
        eq(alerts.fingerprint, input.fingerprint),
        ne(alerts.status, "resolved")
      )
    )
    .limit(1);

  if (existing.length > 0) return false;

  await db.insert(alerts).values({
    laundryId: input.laundryId,
    branchId: input.branchId ?? null,
    deviceId: input.deviceId ?? null,
    severity: input.severity,
    category: input.category,
    title: input.title,
    message: input.message,
    status: "open",
    fingerprint: input.fingerprint,
    metadata: input.metadata ?? {},
  });
  return true;
}

async function autoResolve(laundryId: number, fingerprint: string): Promise<void> {
  await db
    .update(alerts)
    .set({ status: "resolved", resolvedBy: "system", resolvedAt: new Date() })
    .where(
      and(
        eq(alerts.laundryId, laundryId),
        eq(alerts.fingerprint, fingerprint),
        ne(alerts.status, "resolved")
      )
    );
}

function getBackupsDir(): string {
  const fromRoot = "/home/runner/workspace/backups";
  if (fs.existsSync(fromRoot)) return fromRoot;
  return path.join(process.cwd(), "../../backups");
}

function getLatestBackupAgeHours(): number | null {
  try {
    const dir = getBackupsDir();
    if (!fs.existsSync(dir)) return null;
    const manifests = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".manifest.json"))
      .sort()
      .reverse();
    if (manifests.length === 0) return null;
    const raw = fs.readFileSync(path.join(dir, manifests[0]), "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.createdAt) return null;
    return (Date.now() - new Date(parsed.createdAt as string).getTime()) / 3_600_000;
  } catch {
    return null;
  }
}

export async function runAlertChecksForLaundry(
  laundryId: number
): Promise<{ created: number }> {
  let created = 0;
  const bump = (ok: boolean) => { if (ok) created++; };

  const now = Date.now();

  const devices = await db
    .select()
    .from(deviceHeartbeats)
    .where(eq(deviceHeartbeats.laundryId, laundryId));

  for (const d of devices) {
    const mins = (now - new Date(d.lastSeenAt).getTime()) / 60_000;
    const label = d.workerName ?? d.deviceId;

    // Rule 15: Heartbeat missing 5–30 min (info)
    const fp15 = `sync:heartbeat_missing:${d.deviceId}`;
    if (mins > 5 && mins <= 30) {
      bump(await ensureAlert({
        laundryId, branchId: d.branchId, deviceId: d.deviceId,
        severity: "info", category: "sync",
        title: "Heartbeat Missing",
        message: `Device "${label}" has not sent a heartbeat for ${Math.round(mins)} minutes.`,
        fingerprint: fp15,
        metadata: { deviceId: d.deviceId, workerName: d.workerName, minutesSinceLastSeen: Math.round(mins) },
      }));
    } else {
      await autoResolve(laundryId, fp15);
    }

    // Rule 1: Device offline > 30 min (warning)
    const fp1 = `sync:device_offline_30m:${d.deviceId}`;
    if (mins > 30 && mins <= 1440) {
      bump(await ensureAlert({
        laundryId, branchId: d.branchId, deviceId: d.deviceId,
        severity: "warning", category: "sync",
        title: "Device Offline (30+ Minutes)",
        message: `Device "${label}" has been offline for ${Math.round(mins)} minutes.`,
        fingerprint: fp1,
        metadata: { deviceId: d.deviceId, workerName: d.workerName, minutesSinceLastSeen: Math.round(mins) },
      }));
    } else {
      await autoResolve(laundryId, fp1);
    }

    // Rule 2: Device offline > 24 hours (critical)
    const fp2 = `sync:device_offline_24h:${d.deviceId}`;
    if (mins > 1440) {
      bump(await ensureAlert({
        laundryId, branchId: d.branchId, deviceId: d.deviceId,
        severity: "critical", category: "sync",
        title: "Device Gone (24+ Hours)",
        message: `Device "${label}" has been offline for ${Math.round(mins / 60)} hours. Data may be at risk.`,
        fingerprint: fp2,
        metadata: { deviceId: d.deviceId, workerName: d.workerName, hoursOffline: Math.round(mins / 60) },
      }));
    } else {
      await autoResolve(laundryId, fp2);
    }

    // Rule 3: Pending queue > 500 (warning)
    const fp3 = `sync:queue_high:${d.deviceId}`;
    if (d.pendingCount > 500 && d.pendingCount <= 1000) {
      bump(await ensureAlert({
        laundryId, branchId: d.branchId, deviceId: d.deviceId,
        severity: "warning", category: "sync",
        title: "High Pending Queue",
        message: `Device "${label}" has ${d.pendingCount} items pending sync.`,
        fingerprint: fp3,
        metadata: { deviceId: d.deviceId, pendingCount: d.pendingCount },
      }));
    } else {
      await autoResolve(laundryId, fp3);
    }

    // Rule 4: Pending queue > 1000 (critical)
    const fp4 = `sync:queue_critical:${d.deviceId}`;
    if (d.pendingCount > 1000) {
      bump(await ensureAlert({
        laundryId, branchId: d.branchId, deviceId: d.deviceId,
        severity: "critical", category: "sync",
        title: "Critical Queue Overflow",
        message: `Device "${label}" has ${d.pendingCount} items in the sync queue. Immediate action required.`,
        fingerprint: fp4,
        metadata: { deviceId: d.deviceId, pendingCount: d.pendingCount },
      }));
    } else {
      await autoResolve(laundryId, fp4);
    }

    // Rule 5: Failed sync count > 5 (warning)
    const fp5 = `sync:failed_count:${d.deviceId}`;
    if (d.failedCount > 5) {
      bump(await ensureAlert({
        laundryId, branchId: d.branchId, deviceId: d.deviceId,
        severity: "warning", category: "sync",
        title: "Sync Failures Detected",
        message: `Device "${label}" has ${d.failedCount} permanently failed sync items.`,
        fingerprint: fp5,
        metadata: { deviceId: d.deviceId, failedCount: d.failedCount },
      }));
    } else {
      await autoResolve(laundryId, fp5);
    }

    // Rule 6: Conflict count > 2 (warning)
    const fp6 = `sync:conflict_count:${d.deviceId}`;
    if (d.conflictCount > 2) {
      bump(await ensureAlert({
        laundryId, branchId: d.branchId, deviceId: d.deviceId,
        severity: "warning", category: "payment",
        title: "Payment Sync Conflicts",
        message: `Device "${label}" has ${d.conflictCount} unresolved payment sync conflicts.`,
        fingerprint: fp6,
        metadata: { deviceId: d.deviceId, conflictCount: d.conflictCount },
      }));
    } else {
      await autoResolve(laundryId, fp6);
    }
  }

  // Rule 14: Total pending across all devices > 2000 (warning)
  const fp14 = `sync:queue_total_high:${laundryId}`;
  const totalPending = devices.reduce((s, d) => s + d.pendingCount, 0);
  if (totalPending > 2000) {
    bump(await ensureAlert({
      laundryId, severity: "warning", category: "sync",
      title: "Excessive Total Queue Backlog",
      message: `${totalPending} total items pending across ${devices.length} devices. Check network connectivity.`,
      fingerprint: fp14,
      metadata: { totalPending, deviceCount: devices.length },
    }));
  } else {
    await autoResolve(laundryId, fp14);
  }

  // Rule 10: Multiple app versions in use (info)
  const fp10 = `version:app_version_mismatch:${laundryId}`;
  if (devices.length > 1) {
    const versions = [...new Set(devices.map((d) => d.appVersion).filter(Boolean))];
    if (versions.length > 1) {
      bump(await ensureAlert({
        laundryId, severity: "info", category: "version",
        title: "Multiple App Versions Detected",
        message: `${versions.length} different app versions running across ${devices.length} devices: ${versions.join(", ")}.`,
        fingerprint: fp10,
        metadata: { versions, deviceCount: devices.length },
      }));
    } else {
      await autoResolve(laundryId, fp10);
    }
  }

  // Rule 7: Backup missing or older than 24h (critical)
  const fp7 = `backup:missing:${laundryId}`;
  const backupAgeHours = getLatestBackupAgeHours();
  if (backupAgeHours === null || backupAgeHours > 24) {
    bump(await ensureAlert({
      laundryId, severity: "critical", category: "backup",
      title: "Backup Missing or Overdue",
      message:
        backupAgeHours === null
          ? "No database backup found. Create a backup immediately from the Recovery tab."
          : `Last backup is ${Math.round(backupAgeHours)} hours old — daily threshold (24h) exceeded.`,
      fingerprint: fp7,
      metadata: { backupAgeHours, thresholdHours: 24 },
    }));
  } else {
    await autoResolve(laundryId, fp7);
  }

  // Rule 9: Schema checkpoint not taken in 7 days (warning)
  const fp9 = `system:schema_checkpoint_overdue:${laundryId}`;
  const sevenDaysAgo = new Date(now - 7 * 86_400_000);
  const [latestSnapshot] = await db
    .select({ id: schemaSnapshots.id, createdAt: schemaSnapshots.createdAt })
    .from(schemaSnapshots)
    .orderBy(desc(schemaSnapshots.createdAt))
    .limit(1);

  if (!latestSnapshot || new Date(latestSnapshot.createdAt) < sevenDaysAgo) {
    bump(await ensureAlert({
      laundryId, severity: "warning", category: "system",
      title: "Schema Checkpoint Overdue",
      message: latestSnapshot
        ? `Last schema checkpoint was taken more than 7 days ago. Record one before any migration.`
        : "No schema checkpoints recorded. Take a snapshot to enable safe migrations.",
      fingerprint: fp9,
      metadata: {
        latestSnapshotAt: latestSnapshot?.createdAt ?? null,
        thresholdDays: 7,
      },
    }));
  } else {
    await autoResolve(laundryId, fp9);
  }

  return { created };
}

let alertCheckRunning = false;

export async function runAlertChecks(): Promise<{ created: number }> {
  if (alertCheckRunning) {
    console.log("[alert-engine] Skipping check — previous run still in progress");
    return { created: 0 };
  }
  alertCheckRunning = true;
  try {
    const allLaundries = await db
      .select({ id: laundries.id })
      .from(laundries)
      .where(eq(laundries.isActive, true));

    let totalCreated = 0;
    for (const l of allLaundries) {
      const r = await runAlertChecksForLaundry(l.id);
      totalCreated += r.created;
    }
    if (totalCreated > 0) {
      console.log(`[alert-engine] ${totalCreated} new alert(s) created`);
    }
    return { created: totalCreated };
  } catch (err) {
    console.error("[alert-engine] runAlertChecks failed:", err);
    return { created: 0 };
  } finally {
    alertCheckRunning = false;
  }
}
