/**
 * Phase B — Automated Backup Scheduler
 *
 * Runs a daily pg_dump backup at 02:00 UTC.
 * On failure, creates an alert in the alert engine.
 *
 * Off-site storage architecture:
 * ─────────────────────────────
 * Implement the OffSiteStorageAdapter interface and register it via
 * setOffSiteAdapter(). The scheduler will call adapter.upload() after
 * every successful local backup. Three adapters are stubbed below:
 *
 *   - CloudflareR2Adapter  (R2 via S3-compatible API)
 *   - AWSS3Adapter         (S3 via AWS SDK)
 *   - BackblazeB2Adapter   (B2 via S3-compatible API)
 *
 * None are active by default. Set BACKUP_OFFSITE_PROVIDER=r2|s3|b2
 * and the corresponding env vars to activate one.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { db } from "@workspace/db";
import { alerts, laundries } from "@workspace/db/schema";
import { eq, ne, and } from "drizzle-orm";

const execAsync = promisify(exec);

// ── Off-site adapter interface ─────────────────────────────────────────────

export interface OffSiteUploadResult {
  provider: string;
  location: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface OffSiteStorageAdapter {
  readonly name: string;
  upload(localFilePath: string, remoteKey: string): Promise<OffSiteUploadResult>;
  verify(remoteKey: string): Promise<boolean>;
}

// ── Cloudflare R2 (S3-compatible) ─────────────────────────────────────────
// Required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
export class CloudflareR2Adapter implements OffSiteStorageAdapter {
  readonly name = "cloudflare-r2";

  async upload(_localFilePath: string, _remoteKey: string): Promise<OffSiteUploadResult> {
    // Implementation: use @aws-sdk/client-s3 with endpoint:
    // `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    throw new Error(
      "CloudflareR2Adapter not configured. Install @aws-sdk/client-s3 and set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET."
    );
  }

  async verify(_remoteKey: string): Promise<boolean> {
    throw new Error("CloudflareR2Adapter not configured.");
  }
}

// ── AWS S3 ─────────────────────────────────────────────────────────────────
// Required env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET
export class AWSS3Adapter implements OffSiteStorageAdapter {
  readonly name = "aws-s3";

  async upload(_localFilePath: string, _remoteKey: string): Promise<OffSiteUploadResult> {
    // Implementation: use @aws-sdk/client-s3 PutObjectCommand
    throw new Error(
      "AWSS3Adapter not configured. Install @aws-sdk/client-s3 and set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET."
    );
  }

  async verify(_remoteKey: string): Promise<boolean> {
    throw new Error("AWSS3Adapter not configured.");
  }
}

// ── Backblaze B2 (S3-compatible) ───────────────────────────────────────────
// Required env vars: B2_KEY_ID, B2_APP_KEY, B2_BUCKET, B2_ENDPOINT
export class BackblazeB2Adapter implements OffSiteStorageAdapter {
  readonly name = "backblaze-b2";

  async upload(_localFilePath: string, _remoteKey: string): Promise<OffSiteUploadResult> {
    // Implementation: use @aws-sdk/client-s3 with endpoint: process.env.B2_ENDPOINT
    throw new Error(
      "BackblazeB2Adapter not configured. Install @aws-sdk/client-s3 and set B2_KEY_ID, B2_APP_KEY, B2_BUCKET, B2_ENDPOINT."
    );
  }

  async verify(_remoteKey: string): Promise<boolean> {
    throw new Error("BackblazeB2Adapter not configured.");
  }
}

// ── Adapter registry ───────────────────────────────────────────────────────

let activeAdapter: OffSiteStorageAdapter | null = null;

export function setOffSiteAdapter(adapter: OffSiteStorageAdapter): void {
  activeAdapter = adapter;
  console.log(`[backup-scheduler] Off-site adapter registered: ${adapter.name}`);
}

function getBackupsDir(): string {
  const p = path.join("/home/runner/workspace/backups");
  return fs.existsSync(p) ? p : path.join(process.cwd(), "../../backups");
}

function getScriptsDir(): string {
  const p = path.join("/home/runner/workspace/scripts");
  return fs.existsSync(p) ? p : path.join(process.cwd(), "../../scripts");
}

// ── HMAC manifest signing (BACKUP_SECRET) ─────────────────────────────────

function signManifest(manifest: Record<string, unknown>): string {
  const secret = process.env.BACKUP_SECRET!;
  const payload = JSON.stringify(manifest);
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyManifestSignature(manifest: Record<string, unknown>): boolean {
  const { hmacSignature, ...rest } = manifest;
  if (!hmacSignature) return false;
  const expected = signManifest(rest);
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(hmacSignature as string, "hex")
  );
}

// ── Backup failure alerting ────────────────────────────────────────────────

async function fireBackupFailureAlert(reason: string): Promise<void> {
  try {
    const allLaundries = await db
      .select({ id: laundries.id })
      .from(laundries)
      .where(eq(laundries.isActive, true));

    for (const laundry of allLaundries) {
      await db
        .insert(alerts)
        .values({
          laundryId: laundry.id,
          severity: "critical",
          category: "system",
          title: "Automated backup failed",
          message: `The scheduled daily backup failed to complete. Reason: ${reason}. Manual backup required immediately.`,
          status: "open",
          fingerprint: `scheduled-backup-failure:${laundry.id}`,
          metadata: { reason, failedAt: new Date().toISOString() },
        })
        .onConflictDoNothing();
    }
    console.error(`[backup-scheduler] Backup failure alert fired: ${reason}`);
  } catch (alertErr) {
    console.error("[backup-scheduler] Failed to fire backup failure alert:", alertErr);
  }
}

async function resolveBackupAlert(): Promise<void> {
  try {
    const allLaundries = await db
      .select({ id: laundries.id })
      .from(laundries)
      .where(eq(laundries.isActive, true));

    for (const laundry of allLaundries) {
      await db
        .update(alerts)
        .set({ status: "resolved", resolvedBy: "system", resolvedAt: new Date() })
        .where(
          and(
            eq(alerts.laundryId, laundry.id),
            eq(alerts.fingerprint, `scheduled-backup-failure:${laundry.id}`),
            ne(alerts.status, "resolved")
          )
        );
    }
  } catch {
    // Non-critical
  }
}

// ── Run a single backup cycle ──────────────────────────────────────────────

export async function runScheduledBackup(): Promise<void> {
  console.log("[backup-scheduler] Starting scheduled backup...");

  try {
    const scriptsDir = getScriptsDir();
    const backupsDir = getBackupsDir();
    const scriptFile = path.join(scriptsDir, "backup.sh");

    if (!fs.existsSync(scriptFile)) {
      throw new Error(`Backup script not found at ${scriptFile}`);
    }

    fs.mkdirSync(backupsDir, { recursive: true });

    const { stdout, stderr } = await execAsync(
      `bash "${scriptFile}" "${backupsDir}"`,
      { timeout: 180_000, env: { ...process.env } }
    );

    if (stderr && stderr.includes("ERROR")) {
      throw new Error(`Backup script error: ${stderr}`);
    }

    // Read the freshly created manifest and HMAC-sign it
    const manifests = fs
      .readdirSync(backupsDir)
      .filter((f) => f.endsWith(".manifest.json"))
      .sort()
      .reverse();

    if (manifests.length > 0) {
      const manifestPath = path.join(backupsDir, manifests[0]);
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      raw.hmacSignature = signManifest(raw);
      raw.scheduledRun = true;
      raw.runAt = new Date().toISOString();
      fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2));
    }

    // Attempt off-site upload if adapter is configured
    if (activeAdapter && manifests.length > 0) {
      try {
        const backupFile = path.join(backupsDir, manifests[0].replace(".manifest.json", ".sql.gz"));
        const remoteKey = `cleantrack/backups/${manifests[0].replace(".manifest.json", ".sql.gz")}`;
        const result = await activeAdapter.upload(backupFile, remoteKey);
        console.log(`[backup-scheduler] Off-site upload complete: ${result.location}`);
      } catch (uploadErr: any) {
        console.error(`[backup-scheduler] Off-site upload failed (local backup succeeded): ${uploadErr.message}`);
      }
    }

    await resolveBackupAlert();

    console.log(`[backup-scheduler] ✓ Scheduled backup complete. Output:\n${stdout}`);
  } catch (err: any) {
    const reason = err.message ?? "Unknown error";
    console.error(`[backup-scheduler] ✗ Backup failed: ${reason}`);
    await fireBackupFailureAlert(reason);
  }
}

// ── Scheduler (daily at 02:00 UTC) ─────────────────────────────────────────

function msUntilNext2amUTC(): number {
  const now = new Date();
  const next2am = new Date(now);
  next2am.setUTCHours(2, 0, 0, 0);
  if (next2am.getTime() <= now.getTime()) {
    next2am.setUTCDate(next2am.getUTCDate() + 1);
  }
  return next2am.getTime() - now.getTime();
}

export function startBackupScheduler(): void {
  const delayMs = msUntilNext2amUTC();
  const hours = Math.round(delayMs / 3_600_000 * 10) / 10;

  console.log(`[backup-scheduler] Scheduled. Next run in ${hours}h (02:00 UTC daily).`);

  const firstRun = setTimeout(() => {
    runScheduledBackup().catch((err) =>
      console.error("[backup-scheduler] Unhandled error in scheduled backup:", err)
    );

    const interval = setInterval(() => {
      runScheduledBackup().catch((err) =>
        console.error("[backup-scheduler] Unhandled error in scheduled backup:", err)
      );
    }, 24 * 60 * 60 * 1000);

    interval.unref();
  }, delayMs);

  firstRun.unref();
}
