import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

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
