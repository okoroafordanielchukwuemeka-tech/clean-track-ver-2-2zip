import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
// Same ConnectionParameters implementation used internally by pg.
// @ts-ignore - pg exposes this internal module at runtime without a bundled declaration.
import ConnectionParameters from "pg/lib/connection-parameters.js";
import * as schema from "./schema/index.js";

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

// TEMPORARY DIAGNOSTIC: inspect only non-secret connection routing fields.
function logDatabaseConnectionDiagnostic(): void {
  const databaseUrl = process.env.DATABASE_URL;
  const externalDatabaseUrl = process.env.EXTERNAL_DATABASE_URL;
  const selectedVariable = externalDatabaseUrl ? "EXTERNAL_DATABASE_URL" : "DATABASE_URL";
  const selectedUrl = externalDatabaseUrl ?? databaseUrl;

  console.log(`[db-diagnostic] DATABASE_URL exists: ${Boolean(databaseUrl)}`);
  console.log(`[db-diagnostic] EXTERNAL_DATABASE_URL exists: ${Boolean(externalDatabaseUrl)}`);
  console.log(`[db-diagnostic] Selected variable: ${selectedVariable}`);

  if (!selectedUrl) {
    console.log("[db-diagnostic] No database connection string available for parsing");
    return;
  }

  try {
    const parsed = new URL(selectedUrl);
    console.log(`[db-diagnostic] URL parser protocol: ${parsed.protocol.toLowerCase()}`);
  } catch (error) {
    console.log(
      `[db-diagnostic] Standard URL parser rejected value: ${error instanceof Error ? error.name : "UnknownError"}`
    );
  }

  try {
    // ConnectionParameters invokes pg-connection-string internally, the same
    // parser path used by node-postgres when Pool receives connectionString.
    const parsed = new ConnectionParameters({ connectionString: selectedUrl });

    console.log(`[db-diagnostic] pg parser host: ${parsed.host || "<empty>"}`);
    console.log(`[db-diagnostic] pg parser port: ${parsed.port || "<default>"}`);
    console.log(`[db-diagnostic] pg parser database: ${parsed.database || "<empty>"}`);
    console.log(`[db-diagnostic] pg parser username present: ${Boolean(parsed.user)}`);
    console.log(`[db-diagnostic] pg parser SSL enabled: ${Boolean(parsed.ssl)}`);
  } catch (error) {
    console.log(
      `[db-diagnostic] pg connection-string parser failed: ${error instanceof Error ? error.name : "UnknownError"}`
    );
  }
}

logDatabaseConnectionDiagnostic();

export const pool = new Pool({
  connectionString: process.env.EXTERNAL_DATABASE_URL ?? process.env.DATABASE_URL,
  max: isProduction ? 20 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: false,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle client:", err.message);
});

pool.on("connect", () => {
  if (!isProduction) console.log("[db] New client connected to pool");
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
