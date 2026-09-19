#!/usr/bin/env node
/**
 * One-time production schema reconciliation for an existing CleanTrack database.
 *
 * The production Neon database was created before the Drizzle migration ledger
 * was introduced. This script reconstructs migration history from the schema
 * actually present and applies only migrations whose schema signatures are missing.
 *
 * It is idempotent:
 * - If __drizzle_migrations already exists, it does nothing.
 * - It never runs 0000-0002 against the existing production database.
 * - It verifies the baseline before marking 0000-0002 as applied.
 * - For 0003-0005 it checks concrete schema signatures and executes the
 *   checked-in migration SQL only when that signature is missing.
 *
 * After success, normal drizzle-kit migrate owns future changes.
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
  console.error("[db-reconcile] ERROR: DATABASE_URL or EXTERNAL_DATABASE_URL is not set");
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const entries = journal.entries ?? [];
if (entries.length === 0) {
  console.error("[db-reconcile] ERROR: migration journal is empty");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const migrationFile = (tag) => {
  const filePath = path.join(drizzleDir, tag + ".sql");
  if (!fs.existsSync(filePath)) throw new Error("Missing migration SQL file: " + tag + ".sql");
  return filePath;
};

const migrationHash = (tag) =>
  crypto.createHash("sha256").update(fs.readFileSync(migrationFile(tag))).digest("hex");

async function tableExists(client, table) {
  const r = await client.query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS exists",
    [table],
  );
  return r.rows[0]?.exists === true;
}

async function columnExists(client, table, column) {
  const r = await client.query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS exists",
    [table, column],
  );
  return r.rows[0]?.exists === true;
}

async function requiredBaselinePresent(client) {
  const tables = [
    "laundries", "branches", "customers", "orders", "order_items",
    "payment_records", "pickup_records", "services", "workers",
    "worker_permissions", "message_queue", "service_branches",
    "password_reset_tokens", "automation_rules", "campaigns", "invoices",
    "payment_subscriptions", "whatsapp_connections",
  ];
  for (const table of tables) {
    if (!(await tableExists(client, table))) return { ok: false, reason: "missing table " + table };
  }

  const columns = [
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
  for (const [table, column] of columns) {
    if (!(await columnExists(client, table, column))) {
      return { ok: false, reason: "missing column " + table + "." + column };
    }
  }
  return { ok: true };
}

async function ledgerHas(client, hash) {
  const r = await client.query(
    "SELECT 1 FROM public.__drizzle_migrations WHERE hash=$1 LIMIT 1",
    [hash],
  );
  return r.rowCount > 0;
}

async function recordMigration(client, entry) {
  const hash = migrationHash(entry.tag);
  if (await ledgerHas(client, hash)) return;
  await client.query(
    "INSERT INTO public.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
    [hash, entry.when],
  );
  console.log("[db-reconcile] recorded " + entry.tag);
}

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(918273645)");

    if (await tableExists(client, "__drizzle_migrations")) {
      await client.query("COMMIT");
      console.log("[db-reconcile] migration ledger already exists; no reconciliation needed.");
      process.exit(0);
    }

    const baseline = await requiredBaselinePresent(client);
    if (!baseline.ok) {
      throw new Error("existing database does not match the expected CleanTrack baseline: " + baseline.reason);
    }

    await client.query(
      "CREATE TABLE public.__drizzle_migrations (id SERIAL PRIMARY KEY NOT NULL, hash TEXT NOT NULL, created_at BIGINT)"
    );

    const byTag = new Map(entries.map((entry) => [entry.tag, entry]));

    // 0000-0002 are represented by the verified existing baseline. Never replay them.
    for (const tag of [
      "0000_flimsy_captain_marvel",
      "0001_salty_deathbird",
      "0002_phase-719a-baseline",
    ]) {
      const entry = byTag.get(tag);
      if (!entry) throw new Error("Journal entry missing: " + tag);
      await recordMigration(client, entry);
    }

    // 0003: branch operational type.
    {
      const entry = byTag.get("0003_branch_operational_types");
      if (!entry) throw new Error("Journal entry missing: 0003_branch_operational_types");
      if (!(await columnExists(client, "branches", "type"))) {
        console.log("[db-reconcile] applying 0003_branch_operational_types.sql");
        await client.query(fs.readFileSync(migrationFile(entry.tag), "utf8"));
      }
      if (!(await columnExists(client, "branches", "type"))) {
        throw new Error("0003 did not create branches.type");
      }
      await recordMigration(client, entry);
    }

    // 0004: explicit order locations.
    {
      const entry = byTag.get("0004_order_explicit_locations");
      if (!entry) throw new Error("Journal entry missing: 0004_order_explicit_locations");
      const columns = ["collection_branch_id", "processing_branch_id", "return_branch_id", "current_branch_id"];
      let complete = true;
      for (const column of columns) complete = complete && await columnExists(client, "orders", column);
      if (!complete) {
        console.log("[db-reconcile] applying 0004_order_explicit_locations.sql");
        await client.query(fs.readFileSync(migrationFile(entry.tag), "utf8"));
      }
      for (const column of columns) {
        if (!(await columnExists(client, "orders", column))) {
          throw new Error("0004 did not create orders." + column);
        }
      }
      await recordMigration(client, entry);
    }

    // 0005: order movement history.
    {
      const entry = byTag.get("0005_order_movements");
      if (!entry) throw new Error("Journal entry missing: 0005_order_movements");
      if (!(await tableExists(client, "order_movements"))) {
        console.log("[db-reconcile] applying 0005_order_movements.sql");
        await client.query(fs.readFileSync(migrationFile(entry.tag), "utf8"));
      }
      if (!(await tableExists(client, "order_movements"))) {
        throw new Error("0005 did not create order_movements");
      }
      await recordMigration(client, entry);
    }

    await client.query("COMMIT");
    console.log("[db-reconcile] production schema reconciliation completed successfully.");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error("[db-reconcile] ERROR:", error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await pool.end();
}
