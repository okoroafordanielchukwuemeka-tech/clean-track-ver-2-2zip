#!/usr/bin/env node
/**
 * CleanTrack — Drizzle Migration Status
 * Shows which migrations are applied in the database vs pending in the journal.
 *
 * Usage: node scripts/db-migrate-status.mjs
 * Requires: DATABASE_URL env var
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[migrate-status] ERROR: DATABASE_URL is not set");
  process.exit(1);
}

// Read the Drizzle migration journal
const journalPath = path.join(__dirname, "../lib/db/drizzle/meta/_journal.json");
if (!fs.existsSync(journalPath)) {
  console.error("[migrate-status] ERROR: Migration journal not found at", journalPath);
  console.error("  Run 'pnpm db:migrate:generate' to create the first migration.");
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
const allMigrations = journal.entries ?? [];

// Query applied migrations from DB
const pool = new pg.Pool({ connectionString: DATABASE_URL });

try {
  // Check if __drizzle_migrations table exists
  const tableCheck = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = '__drizzle_migrations'
    ) as exists
  `);

  const tableExists = tableCheck.rows[0]?.exists === true;

  let appliedHashes = new Set();
  let appliedRows = [];

  if (tableExists) {
    const result = await pool.query(
      "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC"
    );
    appliedRows = result.rows;
    appliedHashes = new Set(result.rows.map((r) => r.hash));
  }

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║          CleanTrack — Drizzle Migration Status        ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\n  Journal: ${allMigrations.length} migration(s) total`);
  console.log(`  Applied: ${appliedRows.length} migration(s) in database`);
  console.log(`  Pending: ${allMigrations.length - appliedRows.length} migration(s)\n`);

  // Compute file hashes for comparison (Drizzle uses SHA256 of file content)
  const { createHash } = await import("crypto");

  const migrationsDir = path.join(__dirname, "../lib/db/drizzle");
  let pendingCount = 0;

  for (const entry of allMigrations) {
    const sqlFile = path.join(migrationsDir, `${entry.tag}.sql`);
    let fileHash = null;

    if (fs.existsSync(sqlFile)) {
      const content = fs.readFileSync(sqlFile);
      fileHash = createHash("sha256").update(content).digest("hex");
    }

    const isApplied = fileHash ? appliedHashes.has(fileHash) : false;
    const status = isApplied ? "✓ applied " : "✗ pending ";
    const appliedAt = isApplied
      ? appliedRows.find((r) => r.hash === fileHash)?.created_at
      : null;
    const appliedStr = appliedAt
      ? `  (applied: ${new Date(Number(appliedAt)).toISOString()})`
      : "";

    console.log(`  ${status} ${entry.idx.toString().padStart(4, "0")}  ${entry.tag}${appliedStr}`);

    if (!isApplied) pendingCount++;
  }

  if (!tableExists) {
    console.log("\n  ⚠  __drizzle_migrations table does not exist.");
    console.log("     Run 'pnpm db:migrate' to initialize migration tracking.\n");
  } else if (pendingCount === 0) {
    console.log("\n  ✓ All migrations are applied. Database is up to date.\n");
  } else {
    console.log(`\n  ⚠  ${pendingCount} migration(s) pending. Run 'pnpm db:migrate' to apply.\n`);
  }

  process.exit(pendingCount > 0 ? 1 : 0);
} catch (err) {
  console.error("[migrate-status] ERROR:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
