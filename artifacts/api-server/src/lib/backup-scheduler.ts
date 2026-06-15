/**
 * Phase B — Automated Backup Scheduler
 *
 * Runs a daily pg_dump backup at 02:00 UTC.
 * Backups are AES-256-CBC encrypted using BACKUP_SECRET.
 * On failure, creates an alert in the alert engine.
 *
 * Off-site storage:
 * ─────────────────────────────
 * Set BACKUP_OFFSITE_PROVIDER=r2  and the corresponding R2_* env vars
 * to activate Cloudflare R2 upload after each successful local backup.
 *
 * Supported providers:
 *   - r2  → Cloudflare R2 (S3-compatible, uses AWS Sig V4 via native fetch)
 *   - s3  → AWS S3         (same adapter, different endpoint)
 *   - b2  → Backblaze B2   (same adapter, different endpoint)
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

// ── AWS Signature V4 (shared by R2, S3, B2) ───────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getSigningKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmacSha256("AWS4" + secret, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

interface S3CompatConfig {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;   // e.g. https://ACCOUNT_ID.r2.cloudflarestorage.com
  region: string;     // e.g. auto (R2), us-east-1 (S3), us-west-004 (B2)
  bucket: string;
  providerName: string;
}

class S3CompatAdapter implements OffSiteStorageAdapter {
  readonly name: string;
  private cfg: S3CompatConfig;

  constructor(cfg: S3CompatConfig) {
    this.name = cfg.providerName;
    this.cfg = cfg;
  }

  async upload(localFilePath: string, remoteKey: string): Promise<OffSiteUploadResult> {
    const fileBuffer = fs.readFileSync(localFilePath);
    const sizeBytes = fileBuffer.length;
    const contentHash = sha256Hex(fileBuffer);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStamp = amzDate.slice(0, 8);

    const url = new URL(`/${this.cfg.bucket}/${remoteKey}`, this.cfg.endpoint);
    const host = url.host;

    const headers: Record<string, string> = {
      "host": host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": contentHash,
      "content-type": "application/octet-stream",
      "content-length": String(sizeBytes),
    };

    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort()
      .map((k) => `${k}:${headers[k]}\n`).join("");

    const canonicalRequest = [
      "PUT",
      `/${this.cfg.bucket}/${remoteKey}`,
      "",
      canonicalHeaders,
      signedHeaders,
      contentHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = getSigningKey(this.cfg.secretAccessKey, dateStamp, this.cfg.region, "s3");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: { ...headers, authorization },
      body: fileBuffer,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${this.name} upload failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }

    const location = `${this.cfg.endpoint}/${this.cfg.bucket}/${remoteKey}`;
    console.log(`[backup-scheduler] ${this.name} upload OK → ${location} (${sizeBytes} bytes)`);

    return {
      provider: this.name,
      location,
      sizeBytes,
      uploadedAt: now.toISOString(),
    };
  }

  async verify(remoteKey: string): Promise<boolean> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStamp = amzDate.slice(0, 8);

    const url = new URL(`/${this.cfg.bucket}/${remoteKey}`, this.cfg.endpoint);
    const host = url.host;
    const contentHash = sha256Hex("");

    const headers: Record<string, string> = {
      "host": host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": contentHash,
    };

    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort()
      .map((k) => `${k}:${headers[k]}\n`).join("");

    const canonicalRequest = [
      "HEAD",
      `/${this.cfg.bucket}/${remoteKey}`,
      "",
      canonicalHeaders,
      signedHeaders,
      contentHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = getSigningKey(this.cfg.secretAccessKey, dateStamp, this.cfg.region, "s3");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url.toString(), {
      method: "HEAD",
      headers: { ...headers, authorization },
    });

    return res.ok;
  }
}

// ── Factory: build adapter from env vars ──────────────────────────────────

export function buildOffSiteAdapterFromEnv(): OffSiteStorageAdapter | null {
  const provider = process.env.BACKUP_OFFSITE_PROVIDER?.toLowerCase();
  if (!provider) return null;

  if (provider === "r2") {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET_NAME;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      console.warn(
        "[backup-scheduler] BACKUP_OFFSITE_PROVIDER=r2 but missing env vars: " +
        "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME"
      );
      return null;
    }
    return new S3CompatAdapter({
      accessKeyId,
      secretAccessKey,
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      region: "auto",
      bucket,
      providerName: "cloudflare-r2",
    });
  }

  if (provider === "s3") {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || "us-east-1";
    const bucket = process.env.S3_BUCKET_NAME;
    if (!accessKeyId || !secretAccessKey || !bucket) {
      console.warn(
        "[backup-scheduler] BACKUP_OFFSITE_PROVIDER=s3 but missing env vars: " +
        "AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME"
      );
      return null;
    }
    return new S3CompatAdapter({
      accessKeyId,
      secretAccessKey,
      endpoint: `https://s3.${region}.amazonaws.com`,
      region,
      bucket,
      providerName: "aws-s3",
    });
  }

  if (provider === "b2") {
    const accessKeyId = process.env.B2_KEY_ID;
    const secretAccessKey = process.env.B2_APP_KEY;
    const endpoint = process.env.B2_ENDPOINT;
    const bucket = process.env.B2_BUCKET_NAME;
    if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
      console.warn(
        "[backup-scheduler] BACKUP_OFFSITE_PROVIDER=b2 but missing env vars: " +
        "B2_KEY_ID, B2_APP_KEY, B2_ENDPOINT, B2_BUCKET_NAME"
      );
      return null;
    }
    return new S3CompatAdapter({
      accessKeyId,
      secretAccessKey,
      endpoint,
      region: "us-west-004",
      bucket,
      providerName: "backblaze-b2",
    });
  }

  console.warn(`[backup-scheduler] Unknown BACKUP_OFFSITE_PROVIDER: ${provider}. Supported: r2, s3, b2`);
  return null;
}

// ── Legacy manual adapter override ────────────────────────────────────────

let activeAdapter: OffSiteStorageAdapter | null = null;

export function setOffSiteAdapter(adapter: OffSiteStorageAdapter): void {
  activeAdapter = adapter;
  console.log(`[backup-scheduler] Off-site adapter registered: ${adapter.name}`);
}

// ── Path helpers ───────────────────────────────────────────────────────────

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

  // Resolve adapter from env on each run so env changes are picked up
  const adapter = activeAdapter ?? buildOffSiteAdapterFromEnv();

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
      { timeout: 300_000, env: { ...process.env } }
    );

    if (stderr && stderr.includes("ERROR")) {
      throw new Error(`Backup script error: ${stderr}`);
    }

    // Find the freshly created encrypted manifest (most recent)
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

      // Off-site upload — non-fatal if it fails (local backup already succeeded)
      if (adapter) {
        try {
          const backupFileName = manifests[0].replace(".manifest.json", ".sql.gz.enc");
          const backupFilePath = path.join(backupsDir, backupFileName);

          if (fs.existsSync(backupFilePath)) {
            const remoteKey = `cleantrack/backups/${backupFileName}`;
            const result = await adapter.upload(backupFilePath, remoteKey);

            // Also upload the manifest
            const manifestRemoteKey = `cleantrack/backups/${manifests[0]}`;
            await adapter.upload(manifestPath, manifestRemoteKey).catch(() => {});

            console.log(`[backup-scheduler] Off-site upload complete → ${result.location}`);

            // Update manifest with upload info
            raw.offsiteUpload = {
              provider: result.provider,
              location: result.location,
              uploadedAt: result.uploadedAt,
            };
            fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2));
          }
        } catch (uploadErr: any) {
          console.error(
            `[backup-scheduler] Off-site upload failed (local backup succeeded): ${uploadErr.message}`
          );
        }
      } else {
        console.log(
          "[backup-scheduler] No off-site adapter configured. " +
          "Set BACKUP_OFFSITE_PROVIDER=r2|s3|b2 to enable off-site backups."
        );
      }
    }

    await resolveBackupAlert();
    console.log(`[backup-scheduler] ✓ Scheduled backup complete.\n${stdout}`);
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
  const hours = Math.round((delayMs / 3_600_000) * 10) / 10;

  const adapter = buildOffSiteAdapterFromEnv();
  if (adapter) {
    console.log(`[backup-scheduler] Off-site provider: ${adapter.name}`);
  }

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
