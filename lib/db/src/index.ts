import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

// TEMPORARY DIAGNOSTIC: safely inspect the runtime PostgreSQL connection
// configuration without logging credentials, URLs, usernames, or query values.
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
    const protocol = parsed.protocol.toLowerCase();
    const isPostgresProtocol = protocol === "postgres:" || protocol === "postgresql:";

    console.log(`[db-diagnostic] Protocol: ${protocol}`);
    console.log(`[db-diagnostic] Hostname: ${parsed.hostname || "<empty>"}`);
    console.log(`[db-diagnostic] Port: ${parsed.port || "<default>"}`);
    console.log(`[db-diagnostic] Database: ${parsed.pathname.startsWith("/") ? parsed.pathname.slice(1).split("/")[0] || "<empty>" : "<empty>"}`);
    console.log(`[db-diagnostic] Username present: ${Boolean(parsed.username)}`);
    console.log(`[db-diagnostic] Password present: ${Boolean(parsed.password)}`);
    console.log(`[db-diagnostic] SSL parameter present: ${parsed.searchParams.has("sslmode")}`);

    // URL.hostname is the hostname represented by this connection string and is
    // the host value node-postgres will derive when given this URL.
    console.log(`[db-diagnostic] pg hostname: ${isPostgresProtocol ? parsed.hostname || "<empty>" : "<non-postgresql-url>"}`);
  } catch (error) {
    console.log(
      `[db-diagnostic] PostgreSQL URL parsing failed: ${error instanceof Error ? error.name : "UnknownError"}`
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
