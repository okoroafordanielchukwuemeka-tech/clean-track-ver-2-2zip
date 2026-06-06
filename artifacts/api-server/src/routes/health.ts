import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import os from "os";

export const healthRouter = Router();

// ── Basic health (public, for uptime monitors) ────────────────────────────
healthRouter.get("/healthz", async (_req, res) => {
  const startedAt = Date.now();
  let dbStatus = "healthy";
  let dbLatencyMs = 0;

  try {
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - t0;
  } catch {
    dbStatus = "unreachable";
  }

  const overall = dbStatus === "healthy" ? "ok" : "degraded";

  res.status(dbStatus === "healthy" ? 200 : 503).json({
    status: overall,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      loadAvg: os.loadavg(),
      freeMemoryMb: Math.round(os.freemem() / 1_048_576),
      totalMemoryMb: Math.round(os.totalmem() / 1_048_576),
    },
    latencyMs: Date.now() - startedAt,
  });
});
