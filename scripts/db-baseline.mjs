#!/usr/bin/env node
/**
 * CleanTrack — one-time production migration baseline.
 *
 * Purpose:
 *   The existing Neon database already contains the CleanTrack schema/data,
 *   but the Drizzle migration ledger is missing. Running `drizzle-kit migrate`
 *   against that database would try to replay the historical migrations.
 *
 * Safety rules:
 *   - If the Drizzle ledger already exists, this script does nothing.
 *   - If the ledger is missing, it verifies representative tables/columns from
 *     the current CleanTrack schema before creating the ledger.
 *   - It computes the exact SHA-256 hashes from the checked-in SQL files.
 *   - It records the journal timestamps from _journal.json, so future
 *     `drizzle-kit migrate` runs can apply only migrations generated later.
 *   - It never executes any historical migration SQL.
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const drizzleDir = path.join(repoRoot, "lib", "db", "drizzle");
const journalPath = path.join(drizzleDir, "meta", "_journal.json");

const DATABASE_URL = process.env.EXTERNAL_DATABASE_URL ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[db-baseline] ERROR: DATABASE_URL or EXTERNAL_DATABASE_URL is not set");
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const entries = journal.entries ?? [];
if (entries.length === 0) {
  console.error("[db-baseline] ERROR: Drizzle journal contains no migrations");
  process.exit(1);
}

// These are deliberately representative objects from the current CleanTrack
// production schema. If the existing database does not contain them, we abort
// rather than falsely declaring an unknown database as fully migrated.
const requiredTables = [
  "laundries",
  "branches",
  "customers",
  "orders",
  "order_items",
  "payment_records",
  "pickup_records",
  "services",
  "workers",
  "worker_permissions",
  "message_queue",
  "service_branches",
  "password_reset_tokens",
  "automation_rules",
  "campaigns",
  "invoices",
  "payment_subscriptions",
  "whatsapp_connections",
];

const requiredColumns = [
  ["laundries", "failed_login_attempts"],
  ["laundries", "locked_until"],
  ["payment_records", "provider"],
  ["payment_records", "reconciliation_status"],
  ["services", "display_order"],
  ["services", "image_url"],
  ["workers", "failed_pin_attempts"],
  ["worker_permissions", "can_manage_whatsapp"],
  ["notifications", "related_conversation_id"],
  ["platform_admins", "role"],
];

const pool = new Pool({ connectionString: DATABASE_URL });

try {
  const ledgerCheck = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = '__drizzle_migrations'
    ) AS exists
  `);

  if (ledgerCheck.rows[0]?.exists === true) {
    console.log("[db-baseline] Drizzle migration ledger already exists; nothing to baseline.");
    process.exit(0);
  }

  const tableResult = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const existingTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !existingTables.has(table));

  if (missingTables.length > 0) {
    throw new Error(
      `Database does not match the expected CleanTrack baseline. Missing tables: ${missingTables.join(", ")}`
    );
  }

  const columnResult = await pool.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'`
  );
  const existingColumns = new Set(
    columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`)
  );
  const missingColumns = requiredColumns
    .map(([table, column]) => `${table}.${column}`)
    .filter((key) => !existingColumns.has(key));

  if (missingColumns.length > 0) {
    throw new Error(
      `Database does not match the expected CleanTrack baseline. Missing columns: ${missingColumns.join(", ")}`
    );
  }

  const migrations = entries.map((entry) => {
    const filePath = path.join(drizzleDir, `${entry.tag}.sql`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Migration SQL file is missing: ${filePath}`);
    }

    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");

    return {
      hash,
      createdAt: entry.when,
      tag: entry.tag,
    };
  });

  await pool.query("BEGIN");
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
        id SERIAL PRIMARY KEY NOT NULL,
        hash TEXT NOT NULL,
        created_at BIGINT
      )
    `);

    for (const migration of migrations) {
      await pool.query(
        `INSERT INTO public.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [migration.hash, migration.createdAt]
      );
    }

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  console.log(`[db-baseline] Baseline created successfully for ${migrations.length} migrations:`);
  for (const migration of migrations) {
    console.log(`  ✓ ${migration.tag} (${migration.hash})`);
  }
  console.log("[db-baseline] No historical migration SQL was executed.");
  console.log("[db-baseline] Future drizzle-kit migrations can now run normally.");
} catch (error) {
  console.error("[db-baseline] ERROR:", error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await pool.end();
}
