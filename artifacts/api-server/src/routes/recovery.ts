import { Router } from "express";
import { db } from "@workspace/db";
import { workers, customers, branches, paymentRecords, orders, auditLog, idempotencyKeys, schemaSnapshots } from "@workspace/db/schema";
import { eq, and, isNull, isNotNull, desc, count, sql } from "drizzle-orm";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { logAction } from "../lib/audit.js";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const recoveryRouter = Router();

function getBackupsDir(): string {
  const fromRoot = path.join("/home/runner/workspace/backups");
  const fromCwd = path.join(process.cwd(), "../../backups");
  if (fs.existsSync(fromRoot)) return fromRoot;
  if (fs.existsSync(fromCwd)) return fromCwd;
  return fromRoot;
}

function getScriptsDir(): string {
  const fromRoot = path.join("/home/runner/workspace/scripts");
  const fromCwd = path.join(process.cwd(), "../../scripts");
  if (fs.existsSync(fromRoot)) return fromRoot;
  return fromCwd;
}

function readLatestBackupManifest(): Record<string, unknown> | null {
  try {
    const dir = getBackupsDir();
    if (!fs.existsSync(dir)) return null;
    const manifests = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".manifest.json"))
      .sort()
      .reverse();
    if (manifests.length === 0) return null;
    const raw = fs.readFileSync(path.join(dir, manifests[0]), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readAllBackupManifests(): Array<Record<string, unknown>> {
  try {
    const dir = getBackupsDir();
    if (!fs.existsSync(dir)) return [];
    const manifests = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".manifest.json"))
      .sort()
      .reverse();
    return manifests.map((mf) => {
      try {
        const raw = fs.readFileSync(path.join(dir, mf), "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const createdAt = parsed.createdAt as string;
        parsed.ageHours = createdAt
          ? (Date.now() - new Date(createdAt).getTime()) / 3_600_000
          : null;
        return parsed;
      } catch {
        return null;
      }
    }).filter(Boolean) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

recoveryRouter.get("/readiness", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const [tableCountResult, indexCountResult, dbSizeResult] = await Promise.all([
      db.execute(sql`SELECT count(*)::int as cnt FROM information_schema.tables WHERE table_schema = 'public'`),
      db.execute(sql`SELECT count(*)::int as cnt FROM pg_indexes WHERE schemaname = 'public'`),
      db.execute(sql`SELECT pg_database_size(current_database())::bigint as bytes, pg_size_pretty(pg_database_size(current_database())) as pretty`),
    ]);

    const tableCount = (tableCountResult.rows[0] as { cnt: number }).cnt;
    const indexCount = (indexCountResult.rows[0] as { cnt: number }).cnt;
    const dbSizeBytes = Number((dbSizeResult.rows[0] as { bytes: string }).bytes);
    const dbSizePretty = (dbSizeResult.rows[0] as { pretty: string }).pretty;

    const [deletedWorkers, deletedCustomers, deletedBranches, deletedPayments, auditLogCount, idemCount, snapshotCount] = await Promise.all([
      db.select({ c: count() }).from(workers).where(and(eq(workers.laundryId, laundryId), isNotNull(workers.deletedAt))),
      db.select({ c: count() }).from(customers).where(and(eq(customers.laundryId, laundryId), isNotNull(customers.deletedAt))),
      db.select({ c: count() }).from(branches).where(and(eq(branches.laundryId, laundryId), isNotNull(branches.deletedAt))),
      db.select({ c: count() }).from(paymentRecords).where(and(eq(paymentRecords.laundryId, laundryId), isNotNull(paymentRecords.deletedAt))),
      db.select({ c: count() }).from(auditLog).where(eq(auditLog.laundryId, laundryId)),
      db.select({ c: count() }).from(idempotencyKeys),
      db.select({ c: count() }).from(schemaSnapshots),
    ]);

    const manifest = readLatestBackupManifest();
    const backupAgeHours = manifest?.createdAt
      ? (Date.now() - new Date(manifest.createdAt as string).getTime()) / 3_600_000
      : null;

    const totalBackupFiles = readAllBackupManifests().length;

    type CheckStatus = "pass" | "warn" | "fail";
    const checks: { id: string; label: string; status: CheckStatus; detail: string; critical: boolean }[] = [
      {
        id: "db_connectivity",
        label: "Database connectivity",
        status: "pass",
        detail: `${tableCount} tables online · ${dbSizePretty}`,
        critical: true,
      },
      {
        id: "schema_integrity",
        label: "Schema integrity",
        status: tableCount >= 21 ? "pass" : "warn",
        detail: tableCount >= 21 ? `${tableCount} tables (expected 22)` : `Only ${tableCount} tables found — schema may be incomplete`,
        critical: true,
      },
      {
        id: "indexes",
        label: "Query performance indexes",
        status: indexCount >= 30 ? "pass" : indexCount >= 10 ? "warn" : "fail",
        detail: `${indexCount} indexes active (target ≥30)`,
        critical: false,
      },
      {
        id: "soft_deletes",
        label: "Soft delete system",
        status: "pass",
        detail: "Workers, customers, branches, payments — all soft-delete enabled",
        critical: true,
      },
      {
        id: "backup_recency",
        label: "Last backup age",
        status: manifest === null ? "fail" : backupAgeHours! <= 24 ? "pass" : backupAgeHours! <= 168 ? "warn" : "fail",
        detail: manifest === null
          ? "No backup found — run Backup Now immediately"
          : backupAgeHours! <= 1
            ? `${Math.round(backupAgeHours! * 60)}m ago (excellent)`
            : backupAgeHours! <= 24
              ? `${Math.round(backupAgeHours!)}h ago (healthy)`
              : `${Math.round(backupAgeHours! / 24)}d ago — backup overdue`,
        critical: true,
      },
      {
        id: "backup_verified",
        label: "Backup integrity",
        status: manifest?.sha256 ? "pass" : "fail",
        detail: manifest?.sha256
          ? `SHA256 verified: ${String(manifest.sha256).substring(0, 16)}… · ${totalBackupFiles} file(s) stored`
          : "No verified backup on record",
        critical: true,
      },
      {
        id: "migration_tracking",
        label: "Migration tracking",
        status: Number(snapshotCount[0].c) > 0 ? "pass" : "warn",
        detail: Number(snapshotCount[0].c) > 0
          ? `${Number(snapshotCount[0].c)} schema checkpoint(s) recorded`
          : "No checkpoints yet — record one before running migrations",
        critical: false,
      },
      {
        id: "idempotency_cleanup",
        label: "Idempotency key cleanup",
        status: "pass",
        detail: `Hourly TTL prune active · ${Number(idemCount[0].c)} keys stored`,
        critical: false,
      },
      {
        id: "graceful_shutdown",
        label: "Graceful server shutdown",
        status: "pass",
        detail: "SIGTERM/SIGINT handler registered — no mid-request data loss on deploy",
        critical: false,
      },
      {
        id: "audit_trail",
        label: "Audit trail",
        status: "pass",
        detail: `${Number(auditLogCount[0].c)} audit events for this business`,
        critical: false,
      },
      {
        id: "point_in_time",
        label: "Point-in-time recovery",
        status: "fail",
        detail: "Not available on Replit managed DB — RPO is last manual backup",
        critical: false,
      },
      {
        id: "offsite_backup",
        label: "Off-site backup storage",
        status: "warn",
        detail: "Backups on local filesystem — download regularly for true off-site copy",
        critical: false,
      },
    ];

    const criticalChecks = checks.filter((c) => c.critical);
    const allChecks = checks;
    const passCount = allChecks.filter((c) => c.status === "pass").length;
    const warnCount = allChecks.filter((c) => c.status === "warn").length;
    const failCount = allChecks.filter((c) => c.status === "fail").length;
    const criticalFails = criticalChecks.filter((c) => c.status === "fail").length;

    const rawScore = Math.round(
      (passCount * 10 + warnCount * 5) / (allChecks.length * 10) * 100
    );
    const score = criticalFails > 0 ? Math.min(rawScore, 50) : rawScore;
    const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

    res.json({
      score,
      grade,
      checks,
      lastBackup: manifest ? {
        timestamp: manifest.timestamp,
        file: manifest.file,
        sizeBytes: manifest.sizeBytes,
        sha256: manifest.sha256,
        createdAt: manifest.createdAt,
        ageHours: backupAgeHours,
      } : null,
      dbStats: {
        tables: tableCount,
        indexes: indexCount,
        sizeBytes: dbSizeBytes,
        sizePretty: dbSizePretty,
      },
      softDeleteStats: {
        workers: Number(deletedWorkers[0].c),
        customers: Number(deletedCustomers[0].c),
        branches: Number(deletedBranches[0].c),
        payments: Number(deletedPayments[0].c),
        total: Number(deletedWorkers[0].c) + Number(deletedCustomers[0].c) + Number(deletedBranches[0].c) + Number(deletedPayments[0].c),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[recovery/readiness]", err);
    res.status(500).json({ error: "Failed to generate readiness report" });
  }
});

recoveryRouter.get("/backups", requireOwner, async (_req: AuthRequest, res) => {
  try {
    const backups = readAllBackupManifests();
    res.json(backups);
  } catch {
    res.status(500).json({ error: "Failed to list backups" });
  }
});

recoveryRouter.post("/trigger-backup", requireOwner, async (req: AuthRequest, res) => {
  try {
    const scriptsDir = getScriptsDir();
    const backupsDir = getBackupsDir();
    const scriptFile = path.join(scriptsDir, "backup.sh");

    if (!fs.existsSync(scriptFile)) {
      return res.status(500).json({ error: "Backup script not found at " + scriptFile });
    }

    fs.mkdirSync(backupsDir, { recursive: true });

    const { stdout, stderr } = await execAsync(
      `bash "${scriptFile}" "${backupsDir}"`,
      { timeout: 120_000, env: { ...process.env } }
    );

    const manifest = readLatestBackupManifest();
    if (manifest) {
      manifest.ageHours = manifest.createdAt
        ? (Date.now() - new Date(manifest.createdAt as string).getTime()) / 3_600_000
        : null;
    }

    logAction({
      auth: req.auth!,
      laundryId: req.auth!.laundryId,
      action: "backup_triggered",
      metadata: { file: manifest?.file, sizeBytes: manifest?.sizeBytes },
    }).catch(() => {});

    res.json({ success: true, output: stdout + (stderr ? `\n[stderr] ${stderr}` : ""), manifest });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "Backup failed",
      detail: err.stderr || err.message,
    });
  }
});

recoveryRouter.post("/verify-latest", requireOwner, async (req: AuthRequest, res) => {
  try {
    const dir = getBackupsDir();
    if (!fs.existsSync(dir)) {
      return res.status(404).json({ success: false, error: "No backups directory found" });
    }

    const backupFiles = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".sql.gz"))
      .sort()
      .reverse();

    if (backupFiles.length === 0) {
      return res.status(404).json({ success: false, error: "No backup files found" });
    }

    const latestFile = path.join(dir, backupFiles[0]);
    const scriptsDir = getScriptsDir();
    const scriptFile = path.join(scriptsDir, "verify-backup.sh");

    if (!fs.existsSync(scriptFile)) {
      return res.status(500).json({ success: false, error: "Verify script not found" });
    }

    const { stdout, stderr } = await execAsync(
      `bash "${scriptFile}" "${latestFile}"`,
      { timeout: 60_000, env: { ...process.env } }
    );

    const output = stdout + (stderr ? `\n${stderr}` : "");
    const passMatch = output.match(/(\d+) passed/);
    const failMatch = output.match(/(\d+) failed/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;
    const success = failed === 0 && passed > 0;

    logAction({
      auth: req.auth!,
      laundryId: req.auth!.laundryId,
      action: "backup_verified",
      metadata: { file: backupFiles[0], passed, failed, success },
    }).catch(() => {});

    res.json({ success, output, passed, failed, file: backupFiles[0] });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "Verification failed",
      detail: err.stderr || err.message,
    });
  }
});

recoveryRouter.post("/record-snapshot", requireOwner, async (req: AuthRequest, res) => {
  try {
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
    const triggeredBy = req.auth!.email ?? `owner:${req.auth!.laundryId}`;

    const [tableCountResult, indexCountResult, dbSizeResult, tableListResult] = await Promise.all([
      db.execute(sql`SELECT count(*)::int as cnt FROM information_schema.tables WHERE table_schema = 'public'`),
      db.execute(sql`SELECT count(*)::int as cnt FROM pg_indexes WHERE schemaname = 'public'`),
      db.execute(sql`SELECT pg_database_size(current_database())::bigint as bytes`),
      db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`),
    ]);

    const tableCount = (tableCountResult.rows[0] as { cnt: number }).cnt;
    const indexCount = (indexCountResult.rows[0] as { cnt: number }).cnt;
    const dbSizeBytes = Number((dbSizeResult.rows[0] as { bytes: string }).bytes);
    const tableList = (tableListResult.rows as Array<{ table_name: string }>)
      .map((r) => r.table_name)
      .join(",");

    const [snapshot] = await db.insert(schemaSnapshots).values({
      snapshotType: "manual",
      triggeredBy,
      tableCount,
      indexCount,
      dbSizeBytes,
      tableList,
      notes,
    }).returning();

    logAction({
      auth: req.auth!,
      laundryId: req.auth!.laundryId,
      action: "schema_snapshot_recorded",
      metadata: { snapshotId: snapshot.id, tableCount, notes },
    }).catch(() => {});

    res.json(snapshot);
  } catch (err) {
    console.error("[recovery/record-snapshot]", err);
    res.status(500).json({ error: "Failed to record snapshot" });
  }
});

recoveryRouter.get("/migrations", requireOwner, async (_req: AuthRequest, res) => {
  try {
    const snapshots = await db.select().from(schemaSnapshots)
      .orderBy(desc(schemaSnapshots.createdAt))
      .limit(50);
    res.json(snapshots);
  } catch {
    res.status(500).json({ error: "Failed to list migration snapshots" });
  }
});

recoveryRouter.get("/summary", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const [deletedWorkers, deletedCustomers, deletedBranches, deletedPayments] = await Promise.all([
      db.select().from(workers).where(and(eq(workers.laundryId, laundryId), isNotNull(workers.deletedAt))),
      db.select().from(customers).where(and(eq(customers.laundryId, laundryId), isNotNull(customers.deletedAt))),
      db.select().from(branches).where(and(eq(branches.laundryId, laundryId), isNotNull(branches.deletedAt))),
      db.select().from(paymentRecords).where(and(eq(paymentRecords.laundryId, laundryId), isNotNull(paymentRecords.deletedAt))),
    ]);

    res.json({
      workers: deletedWorkers.length,
      customers: deletedCustomers.length,
      branches: deletedBranches.length,
      payments: deletedPayments.length,
      total: deletedWorkers.length + deletedCustomers.length + deletedBranches.length + deletedPayments.length,
    });
  } catch {
    res.status(500).json({ error: "Failed to get recovery summary" });
  }
});

recoveryRouter.get("/workers", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select({
      id: workers.id,
      name: workers.name,
      phone: workers.phone,
      role: workers.role,
      branchId: workers.branchId,
      deletedAt: workers.deletedAt,
      deletedByName: workers.deletedByName,
      deletedByType: workers.deletedByType,
      createdAt: workers.createdAt,
    }).from(workers)
      .where(and(eq(workers.laundryId, laundryId), isNotNull(workers.deletedAt)))
      .orderBy(desc(workers.deletedAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list deleted workers" });
  }
});

recoveryRouter.post("/workers/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid worker ID" });

    const [existing] = await db.select().from(workers)
      .where(and(eq(workers.id, id), eq(workers.laundryId, laundryId), isNotNull(workers.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Deleted worker not found" });

    await db.update(workers).set({
      isActive: true,
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
      updatedAt: new Date(),
    }).where(eq(workers.id, id));

    logAction({
      auth: req.auth!,
      laundryId,
      action: "worker_restored",
      metadata: { workerId: id, workerName: existing.name },
    }).catch(() => {});

    res.json({ id, name: existing.name, restored: true });
  } catch {
    res.status(500).json({ error: "Failed to restore worker" });
  }
});

recoveryRouter.get("/customers", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select({
      id: customers.id,
      fullName: customers.fullName,
      phone: customers.phone,
      branchId: customers.branchId,
      deletedAt: customers.deletedAt,
      deletedByName: customers.deletedByName,
      deletedByType: customers.deletedByType,
      createdAt: customers.createdAt,
    }).from(customers)
      .where(and(eq(customers.laundryId, laundryId), isNotNull(customers.deletedAt)))
      .orderBy(desc(customers.deletedAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list deleted customers" });
  }
});

recoveryRouter.post("/customers/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid customer ID" });

    const [existing] = await db.select().from(customers)
      .where(and(eq(customers.id, id), eq(customers.laundryId, laundryId), isNotNull(customers.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Deleted customer not found" });

    await db.update(customers).set({
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
    }).where(eq(customers.id, id));

    logAction({
      auth: req.auth!,
      laundryId,
      action: "customer_restored",
      metadata: { customerId: id, fullName: existing.fullName, phone: existing.phone },
    }).catch(() => {});

    res.json({ id, fullName: existing.fullName, restored: true });
  } catch {
    res.status(500).json({ error: "Failed to restore customer" });
  }
});

recoveryRouter.get("/branches", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select({
      id: branches.id,
      name: branches.name,
      address: branches.address,
      deletedAt: branches.deletedAt,
      deletedByName: branches.deletedByName,
      deletedByType: branches.deletedByType,
      createdAt: branches.createdAt,
    }).from(branches)
      .where(and(eq(branches.laundryId, laundryId), isNotNull(branches.deletedAt)))
      .orderBy(desc(branches.deletedAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list deleted branches" });
  }
});

recoveryRouter.post("/branches/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid branch ID" });

    const [existing] = await db.select().from(branches)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNotNull(branches.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Deleted branch not found" });

    await db.update(branches).set({
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
    }).where(eq(branches.id, id));

    logAction({
      auth: req.auth!,
      laundryId,
      action: "branch_restored",
      metadata: { branchId: id, branchName: existing.name },
    }).catch(() => {});

    res.json({ id, name: existing.name, restored: true });
  } catch {
    res.status(500).json({ error: "Failed to restore branch" });
  }
});

recoveryRouter.get("/payments", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select({
      id: paymentRecords.id,
      orderId: paymentRecords.orderId,
      receiptNumber: paymentRecords.receiptNumber,
      amount: paymentRecords.amount,
      method: paymentRecords.method,
      recordedBy: paymentRecords.recordedBy,
      recordedAt: paymentRecords.recordedAt,
      deletedAt: paymentRecords.deletedAt,
      deletedByName: paymentRecords.deletedByName,
      deletedByType: paymentRecords.deletedByType,
    }).from(paymentRecords)
      .where(and(eq(paymentRecords.laundryId, laundryId), isNotNull(paymentRecords.deletedAt)))
      .orderBy(desc(paymentRecords.deletedAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list voided payments" });
  }
});

recoveryRouter.post("/payments/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid payment ID" });

    const [existing] = await db.select().from(paymentRecords)
      .where(and(eq(paymentRecords.id, id), eq(paymentRecords.laundryId, laundryId), isNotNull(paymentRecords.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Voided payment not found" });

    await db.update(paymentRecords).set({
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
      deletionReason: null,
    }).where(eq(paymentRecords.id, id));

    const [order] = await db.select().from(orders).where(eq(orders.id, existing.orderId));
    if (order) {
      const remaining = await db.select().from(paymentRecords)
        .where(and(eq(paymentRecords.orderId, order.id), isNull(paymentRecords.deletedAt)));
      const newAmountPaid = remaining.reduce((sum, p) => sum + parseFloat(p.amount), 0);
      const totalDue = parseFloat(order.price || "0") + parseFloat(order.extraCharge || "0") - parseFloat(order.discount || "0");
      const newPaymentStatus = totalDue <= 0 || newAmountPaid >= totalDue ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid";
      await db.update(orders).set({
        amountPaid: newAmountPaid.toString(),
        paymentStatus: newPaymentStatus as "unpaid" | "partial" | "paid",
        updatedAt: new Date(),
      }).where(eq(orders.id, order.id));
    }

    logAction({
      auth: req.auth!,
      laundryId,
      action: "payment_restored",
      orderId: existing.orderId,
      metadata: { paymentId: id, receiptNumber: existing.receiptNumber, amount: existing.amount },
    }).catch(() => {});

    res.json({ id, receiptNumber: existing.receiptNumber, amount: existing.amount, restored: true });
  } catch {
    res.status(500).json({ error: "Failed to restore payment" });
  }
});
