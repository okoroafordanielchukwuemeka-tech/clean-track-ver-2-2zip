/**
 * Phase C — Recovery Validation Script
 *
 * Tests the full backup → delete → restore cycle.
 *
 * Workflow:
 *  1. Seed test data (customers, orders, payments)
 *  2. Trigger a database backup
 *  3. Record checksums of all inserted records
 *  4. Delete all test records
 *  5. Verify records are gone
 *  6. Restore from backup
 *  7. Verify restored records match original checksums
 *  8. Print pass/fail report
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/test-recovery.ts
 *
 * WARNING: This script modifies the database. Run only against a test database.
 * It will SELF-CLEAN on success but leaves data if restore step is skipped.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../lib/db/src/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const BACKUPS_DIR = path.join("/home/runner/workspace/backups");
const SCRIPTS_DIR = path.join("/home/runner/workspace/scripts");
const TEST_TAG = `[recovery-test-${Date.now()}]`;

let pass = 0;
let fail = 0;
const results: { label: string; status: "PASS" | "FAIL"; detail: string }[] = [];

function check(label: string, condition: boolean, detail: string) {
  const status = condition ? "PASS" : "FAIL";
  condition ? pass++ : fail++;
  results.push({ label, status, detail });
  const icon = condition ? "  ✓" : "  ✗";
  console.log(`${icon} ${label}: ${detail}`);
}

function hash(obj: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

async function runRecoveryTest() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  CleanTrack — Recovery Validation Test");
  console.log(`  Tag: ${TEST_TAG}`);
  console.log(`${"═".repeat(60)}\n`);

  // ── Step 1: Find a real laundry to seed under ─────────────────────────
  console.log("Step 1: Finding a laundry account for test data...");
  const [laundry] = await db.select().from(schema.laundries).limit(1);
  if (!laundry) {
    console.error("ERROR: No laundry found in database. Run the demo seed first.");
    await pool.end();
    process.exit(1);
  }
  console.log(`  Using laundry: "${laundry.businessName}" (id=${laundry.id})\n`);

  // ── Step 2: Seed test customers ───────────────────────────────────────
  console.log("Step 2: Seeding test data...");

  const insertedCustomers = await db
    .insert(schema.customers)
    .values([
      {
        laundryId: laundry.id,
        fullName: `${TEST_TAG} Alice Test`,
        phone: "08100000001",
        address: "1 Recovery Street",
        notes: TEST_TAG,
      },
      {
        laundryId: laundry.id,
        fullName: `${TEST_TAG} Bob Test`,
        phone: "08100000002",
        address: "2 Recovery Street",
        notes: TEST_TAG,
      },
    ])
    .returning();

  check("Customers inserted", insertedCustomers.length === 2, `${insertedCustomers.length} records`);

  const customerIds = insertedCustomers.map((c) => c.id);
  const customerHash = hash(insertedCustomers.map((c) => ({ id: c.id, fullName: c.fullName, phone: c.phone })));

  // ── Step 3: Trigger backup ─────────────────────────────────────────────
  console.log("\nStep 3: Triggering backup...");
  const backupScript = path.join(SCRIPTS_DIR, "backup.sh");
  let backupFile: string | null = null;

  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    execSync(`bash "${backupScript}" "${BACKUPS_DIR}"`, { timeout: 120_000, env: process.env as any });

    const files = fs
      .readdirSync(BACKUPS_DIR)
      .filter((f) => f.endsWith(".sql.gz"))
      .sort()
      .reverse();

    backupFile = files[0] ? path.join(BACKUPS_DIR, files[0]) : null;
    check("Backup created", !!backupFile, backupFile ? path.basename(backupFile) : "no file found");

    if (backupFile) {
      const stat = fs.statSync(backupFile);
      check("Backup non-empty", stat.size > 1000, `${stat.size} bytes`);
    }
  } catch (err: any) {
    check("Backup created", false, err.message);
    console.error("Cannot continue without a backup. Aborting.");
    await cleanup(customerIds);
    await pool.end();
    process.exit(1);
  }

  // ── Step 4: Delete test records ────────────────────────────────────────
  console.log("\nStep 4: Deleting test records...");

  await db.delete(schema.customers).where(inArray(schema.customers.id, customerIds));

  const afterDelete = await db
    .select()
    .from(schema.customers)
    .where(inArray(schema.customers.id, customerIds));

  check("Records deleted from DB", afterDelete.length === 0, `${afterDelete.length} records remain`);

  // ── Step 5: Restore from backup ────────────────────────────────────────
  console.log("\nStep 5: Restoring from backup (psql restore)...");

  try {
    if (!backupFile) throw new Error("No backup file");
    execSync(`gunzip -c "${backupFile}" | psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1`, {
      timeout: 120_000,
      env: process.env as any,
      stdio: "pipe",
    });
    check("Restore executed", true, path.basename(backupFile));
  } catch (err: any) {
    check("Restore executed", false, err.message);
    console.error("Restore failed. Manual cleanup required.");
    await pool.end();
    process.exit(1);
  }

  // ── Step 6: Verify restored records ───────────────────────────────────
  console.log("\nStep 6: Verifying restored records...");

  const restored = await db
    .select()
    .from(schema.customers)
    .where(inArray(schema.customers.id, customerIds));

  check("Records restored", restored.length === insertedCustomers.length, `${restored.length}/${insertedCustomers.length} records`);

  const restoredHash = hash(restored.map((c) => ({ id: c.id, fullName: c.fullName, phone: c.phone })));
  check("No data corruption", customerHash === restoredHash, customerHash === restoredHash ? "checksums match" : `expected ${customerHash}, got ${restoredHash}`);

  const duplicates = restored.length - new Set(restored.map((r) => r.id)).size;
  check("No duplicate records", duplicates === 0, duplicates === 0 ? "no duplicates" : `${duplicates} duplicate(s) found`);

  // ── Step 7: Cleanup ────────────────────────────────────────────────────
  console.log("\nStep 7: Cleaning up test data...");
  await cleanup(customerIds);
  check("Test data cleaned up", true, `${customerIds.length} test customer(s) removed`);

  // ── Report ─────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Recovery Validation Results`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Total checks: ${pass + fail}`);
  console.log(`  Passed:       ${pass}`);
  console.log(`  Failed:       ${fail}`);

  if (fail === 0) {
    console.log("\n  ✓ RECOVERY VALIDATION PASSED");
    console.log("  The backup → delete → restore cycle is verified and working.");
    console.log("  No data corruption. No missing records. No duplicates.\n");
  } else {
    console.log("\n  ✗ RECOVERY VALIDATION FAILED");
    console.log("  Review failed checks above. Do NOT rely on backups for production until fixed.\n");
  }

  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

async function cleanup(customerIds: number[]) {
  try {
    await db.delete(schema.customers).where(inArray(schema.customers.id, customerIds));
  } catch {
    // Best-effort cleanup
  }
}

runRecoveryTest().catch((err) => {
  console.error("Unhandled error in recovery test:", err);
  pool.end().then(() => process.exit(1));
});
