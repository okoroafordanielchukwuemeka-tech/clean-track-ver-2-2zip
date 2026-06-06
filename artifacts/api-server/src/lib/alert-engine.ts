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
import { computeUsageWithLimits } from "./usage-service.js";

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

interface LaundrySubscriptionData {
  subscriptionStatus?: string | null;
  trialEndsAt?: Date | null;
  subscriptionTier?: string | null;
}

export async function runAlertChecksForLaundry(
  laundryId: number,
  laundryData?: LaundrySubscriptionData
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

  // ── Subscription / Trial alert rules ────────────────────────────────────
  if (laundryData?.subscriptionStatus === "trial" && laundryData?.trialEndsAt) {
    const trialEndsAt = new Date(laundryData.trialEndsAt);
    const daysRemaining = (trialEndsAt.getTime() - now) / 86_400_000;

    const fpExpired = `subscription:trial_expired:${laundryId}`;
    if (daysRemaining <= 0) {
      bump(await ensureAlert({
        laundryId, severity: "critical", category: "subscription",
        title: "Trial Period Expired",
        message: "Your free trial has ended. Upgrade to a paid plan to continue full access to CleanTrack.",
        fingerprint: fpExpired,
        metadata: { trialEndsAt: laundryData.trialEndsAt, daysRemaining: Math.floor(daysRemaining) },
      }));
    } else {
      await autoResolve(laundryId, fpExpired);
    }

    const fp1d = `subscription:trial_1d:${laundryId}`;
    if (daysRemaining > 0 && daysRemaining <= 1) {
      bump(await ensureAlert({
        laundryId, severity: "critical", category: "subscription",
        title: "Trial Ends Tomorrow",
        message: "Your trial expires in less than 24 hours. Upgrade now to avoid service interruption.",
        fingerprint: fp1d,
        metadata: { trialEndsAt: laundryData.trialEndsAt, daysRemaining: Math.ceil(daysRemaining) },
      }));
    } else {
      await autoResolve(laundryId, fp1d);
    }

    const fp3d = `subscription:trial_3d:${laundryId}`;
    if (daysRemaining > 1 && daysRemaining <= 3) {
      bump(await ensureAlert({
        laundryId, severity: "warning", category: "subscription",
        title: "Trial Ending in 3 Days",
        message: `Your trial ends in ${Math.ceil(daysRemaining)} day(s). Upgrade to keep full access.`,
        fingerprint: fp3d,
        metadata: { trialEndsAt: laundryData.trialEndsAt, daysRemaining: Math.ceil(daysRemaining) },
      }));
    } else {
      await autoResolve(laundryId, fp3d);
    }

    const fp7d = `subscription:trial_7d:${laundryId}`;
    if (daysRemaining > 3 && daysRemaining <= 7) {
      bump(await ensureAlert({
        laundryId, severity: "info", category: "subscription",
        title: "Trial Ending in 7 Days",
        message: `You have ${Math.ceil(daysRemaining)} days left in your trial. Consider upgrading now.`,
        fingerprint: fp7d,
        metadata: { trialEndsAt: laundryData.trialEndsAt, daysRemaining: Math.ceil(daysRemaining) },
      }));
    } else {
      await autoResolve(laundryId, fp7d);
    }
  }

  const fpPastDue = `subscription:past_due:${laundryId}`;
  if (laundryData?.subscriptionStatus === "past_due") {
    bump(await ensureAlert({
      laundryId, severity: "warning", category: "subscription",
      title: "Payment Past Due",
      message: "Your subscription payment is overdue. Please update your billing to avoid suspension.",
      fingerprint: fpPastDue,
      metadata: { subscriptionStatus: laundryData.subscriptionStatus },
    }));
  } else {
    await autoResolve(laundryId, fpPastDue);
  }

  const fpSuspended = `subscription:suspended:${laundryId}`;
  if (laundryData?.subscriptionStatus === "suspended") {
    bump(await ensureAlert({
      laundryId, severity: "critical", category: "subscription",
      title: "Account Suspended",
      message: "This account is suspended. New orders, workers, and branch creation are blocked.",
      fingerprint: fpSuspended,
      metadata: { subscriptionStatus: laundryData.subscriptionStatus },
    }));
  } else {
    await autoResolve(laundryId, fpSuspended);
  }

  // ── Plan Usage Warning Rules ─────────────────────────────────────────────
  // Only run for active/trial accounts (not suspended/cancelled)
  const activeStatus = laundryData?.subscriptionStatus;
  if (activeStatus && activeStatus !== "suspended" && activeStatus !== "cancelled") {
    try {
      const plan = laundryData?.subscriptionTier ?? "free";
      const usage = await computeUsageWithLimits(laundryId, plan);

      // Orders usage warnings
      const fpOrders100 = `usage:orders_100:${laundryId}`;
      const fpOrders85 = `usage:orders_85:${laundryId}`;
      const fpOrders70 = `usage:orders_70:${laundryId}`;

      if (usage.percentages.orders >= 100) {
        bump(await ensureAlert({
          laundryId, severity: "critical", category: "subscription",
          title: "Monthly Order Limit Reached",
          message: `You have used all ${usage.limits.maxOrdersPerMonth} orders allowed this month. New orders are blocked until next month or you upgrade.`,
          fingerprint: fpOrders100,
          metadata: { used: usage.monthlyOrderCount, limit: usage.limits.maxOrdersPerMonth, pct: usage.percentages.orders },
        }));
        await autoResolve(laundryId, fpOrders85);
        await autoResolve(laundryId, fpOrders70);
      } else if (usage.percentages.orders >= 85) {
        await autoResolve(laundryId, fpOrders100);
        bump(await ensureAlert({
          laundryId, severity: "warning", category: "subscription",
          title: "Order Limit at 85%",
          message: `You've used ${usage.monthlyOrderCount} of ${usage.limits.maxOrdersPerMonth} orders this month (${usage.percentages.orders}%). Consider upgrading soon.`,
          fingerprint: fpOrders85,
          metadata: { used: usage.monthlyOrderCount, limit: usage.limits.maxOrdersPerMonth, pct: usage.percentages.orders },
        }));
        await autoResolve(laundryId, fpOrders70);
      } else if (usage.percentages.orders >= 70) {
        await autoResolve(laundryId, fpOrders100);
        await autoResolve(laundryId, fpOrders85);
        bump(await ensureAlert({
          laundryId, severity: "info", category: "subscription",
          title: "Order Limit at 70%",
          message: `You've used ${usage.monthlyOrderCount} of ${usage.limits.maxOrdersPerMonth} orders this month (${usage.percentages.orders}%).`,
          fingerprint: fpOrders70,
          metadata: { used: usage.monthlyOrderCount, limit: usage.limits.maxOrdersPerMonth, pct: usage.percentages.orders },
        }));
      } else {
        await autoResolve(laundryId, fpOrders100);
        await autoResolve(laundryId, fpOrders85);
        await autoResolve(laundryId, fpOrders70);
      }

      // Workers usage warnings
      const fpWorkers100 = `usage:workers_100:${laundryId}`;
      const fpWorkers85 = `usage:workers_85:${laundryId}`;
      const fpWorkers70 = `usage:workers_70:${laundryId}`;

      if (usage.percentages.workers >= 100) {
        bump(await ensureAlert({
          laundryId, severity: "critical", category: "subscription",
          title: "Worker Limit Reached",
          message: `You have ${usage.activeWorkerCount} active workers — the maximum for your plan (${usage.limits.maxWorkers}). Upgrade to add more.`,
          fingerprint: fpWorkers100,
          metadata: { used: usage.activeWorkerCount, limit: usage.limits.maxWorkers, pct: usage.percentages.workers },
        }));
        await autoResolve(laundryId, fpWorkers85);
        await autoResolve(laundryId, fpWorkers70);
      } else if (usage.percentages.workers >= 85) {
        await autoResolve(laundryId, fpWorkers100);
        bump(await ensureAlert({
          laundryId, severity: "warning", category: "subscription",
          title: "Worker Limit at 85%",
          message: `You have ${usage.activeWorkerCount} of ${usage.limits.maxWorkers} allowed workers (${usage.percentages.workers}%). Plan for capacity soon.`,
          fingerprint: fpWorkers85,
          metadata: { used: usage.activeWorkerCount, limit: usage.limits.maxWorkers, pct: usage.percentages.workers },
        }));
        await autoResolve(laundryId, fpWorkers70);
      } else if (usage.percentages.workers >= 70) {
        await autoResolve(laundryId, fpWorkers100);
        await autoResolve(laundryId, fpWorkers85);
        bump(await ensureAlert({
          laundryId, severity: "info", category: "subscription",
          title: "Worker Capacity at 70%",
          message: `You have ${usage.activeWorkerCount} of ${usage.limits.maxWorkers} allowed workers (${usage.percentages.workers}%).`,
          fingerprint: fpWorkers70,
          metadata: { used: usage.activeWorkerCount, limit: usage.limits.maxWorkers, pct: usage.percentages.workers },
        }));
      } else {
        await autoResolve(laundryId, fpWorkers100);
        await autoResolve(laundryId, fpWorkers85);
        await autoResolve(laundryId, fpWorkers70);
      }

      // Branches usage warnings
      const fpBranches100 = `usage:branches_100:${laundryId}`;
      const fpBranches85 = `usage:branches_85:${laundryId}`;
      const fpBranches70 = `usage:branches_70:${laundryId}`;

      if (usage.percentages.branches >= 100) {
        bump(await ensureAlert({
          laundryId, severity: "critical", category: "subscription",
          title: "Branch Limit Reached",
          message: `You have ${usage.activeBranchCount} branches — the maximum for your plan (${usage.limits.maxBranches}). Upgrade to add more.`,
          fingerprint: fpBranches100,
          metadata: { used: usage.activeBranchCount, limit: usage.limits.maxBranches, pct: usage.percentages.branches },
        }));
        await autoResolve(laundryId, fpBranches85);
        await autoResolve(laundryId, fpBranches70);
      } else if (usage.percentages.branches >= 85) {
        await autoResolve(laundryId, fpBranches100);
        bump(await ensureAlert({
          laundryId, severity: "warning", category: "subscription",
          title: "Branch Limit at 85%",
          message: `You have ${usage.activeBranchCount} of ${usage.limits.maxBranches} allowed branches (${usage.percentages.branches}%).`,
          fingerprint: fpBranches85,
          metadata: { used: usage.activeBranchCount, limit: usage.limits.maxBranches, pct: usage.percentages.branches },
        }));
        await autoResolve(laundryId, fpBranches70);
      } else if (usage.percentages.branches >= 70) {
        await autoResolve(laundryId, fpBranches100);
        await autoResolve(laundryId, fpBranches85);
        bump(await ensureAlert({
          laundryId, severity: "info", category: "subscription",
          title: "Branch Capacity at 70%",
          message: `You have ${usage.activeBranchCount} of ${usage.limits.maxBranches} allowed branches (${usage.percentages.branches}%).`,
          fingerprint: fpBranches70,
          metadata: { used: usage.activeBranchCount, limit: usage.limits.maxBranches, pct: usage.percentages.branches },
        }));
      } else {
        await autoResolve(laundryId, fpBranches100);
        await autoResolve(laundryId, fpBranches85);
        await autoResolve(laundryId, fpBranches70);
      }

      // Storage usage warnings
      const fpStorage100 = `usage:storage_100:${laundryId}`;
      const fpStorage85 = `usage:storage_85:${laundryId}`;
      const fpStorage70 = `usage:storage_70:${laundryId}`;

      if (usage.percentages.storage >= 100) {
        bump(await ensureAlert({
          laundryId, severity: "critical", category: "subscription",
          title: "Storage Limit Reached",
          message: `Estimated storage (${usage.storageUsedMb} MB) has reached your plan limit (${usage.limits.maxStorageMb} MB). Upgrade to continue.`,
          fingerprint: fpStorage100,
          metadata: { usedMb: usage.storageUsedMb, limitMb: usage.limits.maxStorageMb, pct: usage.percentages.storage },
        }));
        await autoResolve(laundryId, fpStorage85);
        await autoResolve(laundryId, fpStorage70);
      } else if (usage.percentages.storage >= 85) {
        await autoResolve(laundryId, fpStorage100);
        bump(await ensureAlert({
          laundryId, severity: "warning", category: "subscription",
          title: "Storage at 85%",
          message: `Estimated storage usage is ${usage.storageUsedMb} MB of ${usage.limits.maxStorageMb} MB (${usage.percentages.storage}%).`,
          fingerprint: fpStorage85,
          metadata: { usedMb: usage.storageUsedMb, limitMb: usage.limits.maxStorageMb, pct: usage.percentages.storage },
        }));
        await autoResolve(laundryId, fpStorage70);
      } else if (usage.percentages.storage >= 70) {
        await autoResolve(laundryId, fpStorage100);
        await autoResolve(laundryId, fpStorage85);
        bump(await ensureAlert({
          laundryId, severity: "info", category: "subscription",
          title: "Storage at 70%",
          message: `Estimated storage usage is ${usage.storageUsedMb} MB of ${usage.limits.maxStorageMb} MB (${usage.percentages.storage}%).`,
          fingerprint: fpStorage70,
          metadata: { usedMb: usage.storageUsedMb, limitMb: usage.limits.maxStorageMb, pct: usage.percentages.storage },
        }));
      } else {
        await autoResolve(laundryId, fpStorage100);
        await autoResolve(laundryId, fpStorage85);
        await autoResolve(laundryId, fpStorage70);
      }
    } catch (err) {
      console.error(`[alert-engine] Usage check failed for laundry ${laundryId}:`, err);
    }
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
      .select({
        id: laundries.id,
        subscriptionStatus: laundries.subscriptionStatus,
        subscriptionTier: laundries.subscriptionTier,
        trialEndsAt: laundries.trialEndsAt,
      })
      .from(laundries)
      .where(eq(laundries.isActive, true));

    let totalCreated = 0;
    for (const l of allLaundries) {
      const r = await runAlertChecksForLaundry(l.id, {
        subscriptionStatus: l.subscriptionStatus,
        subscriptionTier: l.subscriptionTier,
        trialEndsAt: l.trialEndsAt,
      });
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
