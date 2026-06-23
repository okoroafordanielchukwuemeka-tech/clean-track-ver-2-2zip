import { validateEnvironment } from "./lib/env-validation.js";

// ── Phase D: Validate environment FIRST — crash before binding to any port ──
validateEnvironment();

import app from "./app.js";
import { db } from "@workspace/db";
import { idempotencyKeys } from "@workspace/db/schema";
import { lt } from "drizzle-orm";
import { runAlertChecks } from "./lib/alert-engine.js";
import { startBackupScheduler } from "./lib/backup-scheduler.js";
import { startMessageQueueWorker } from "./lib/message-queue-worker.js";
import { startSubscriptionLifecycleScheduler } from "./lib/subscription-lifecycle.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

if (!process.env.ALLOWED_ORIGINS) {
  console.warn(
    "[security] ⚠ ALLOWED_ORIGINS is not set — CORS accepts all origins. " +
    "Set ALLOWED_ORIGINS in production to restrict access."
  );
}

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`API server running on port ${PORT}`);
  scheduleIdempotencyCleanup();
  scheduleAlertChecks();
  // Phase B: start daily backup scheduler
  startBackupScheduler();
  // Task #3: start durable WhatsApp message queue worker
  startMessageQueueWorker();
  // Subscription lifecycle: trial expiry + grace period automation
  startSubscriptionLifecycleScheduler();
});

function scheduleIdempotencyCleanup() {
  const TTL_MS = 24 * 60 * 60 * 1000;
  const INTERVAL_MS = 60 * 60 * 1000;

  const runCleanup = async () => {
    try {
      const cutoff = new Date(Date.now() - TTL_MS);
      const result = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff));
      const count = (result as any).rowCount ?? 0;
      if (count > 0) console.log(`[cleanup] Removed ${count} expired idempotency key(s)`);
    } catch (err) {
      console.error("[cleanup] Idempotency key cleanup failed:", err);
    }
  };

  const timer = setInterval(runCleanup, INTERVAL_MS);
  timer.unref();
}

function scheduleAlertChecks() {
  const INTERVAL_MS = 5 * 60 * 1000;

  runAlertChecks().catch((err) =>
    console.error("[alert-engine] startup check failed:", err)
  );

  const timer = setInterval(() => {
    runAlertChecks().catch((err) =>
      console.error("[alert-engine] scheduled check failed:", err)
    );
  }, INTERVAL_MS);
  timer.unref();
}

function gracefulShutdown(signal: string) {
  console.log(`[shutdown] Received ${signal}. Closing HTTP server gracefully…`);
  server.close((err) => {
    if (err) {
      console.error("[shutdown] Error closing server:", err);
      process.exit(1);
    }
    console.log("[shutdown] HTTP server closed. Exiting.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[shutdown] Forced exit after 10s timeout.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("[fatal] Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] Unhandled promise rejection:", reason);
  process.exit(1);
});
