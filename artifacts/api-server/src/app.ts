import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import crypto from "crypto";
import { router } from "./routes/index.js";
import { versionMiddleware } from "./middleware/version.js";
import {
  authLimiter,
  demoLimiter,
  apiLimiter,
  webhookLimiter,
  adminLimiter,
  ownerLimiter,
  recoveryLimiter,
  passwordResetLimiter,
} from "./lib/rate-limiter.js";
import { trackError } from "./lib/error-tracker.js";
import { logError } from "./lib/logger.js";
import type { AuthRequest } from "./middleware/auth.js";
import { getStorageRoot, STORAGE_PUBLIC_PREFIX } from "./lib/storage.js";

const app = express();

// ── Trust proxy (Replit runs behind a reverse proxy) ─────────────────────
// Required for req.ip to return the real client IP (not ::1/::ffff:127.0.0.1)
// and for express-rate-limit v8 to generate keys correctly.
app.set("trust proxy", 1);

// ── Compression ───────────────────────────────────────────────────────────
// Gzip/deflate all responses. Excludes already-compressed binary content
// (images, video) automatically. Saves ~60-80% on JSON API responses.
app.use(compression());

// ── Phase D: Request ID middleware ────────────────────────────────────────
// Attach a unique request ID to every request for log correlation.
app.use((req: AuthRequest & { requestId?: string }, _res: Response, next: NextFunction) => {
  req.requestId = crypto.randomUUID();
  next();
});

// ── Security headers (Phase A) ────────────────────────────────────────────
// helmet sets: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
// Strict-Transport-Security, Referrer-Policy, and more.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // Frontend is a separate Vite app; skip CSP on API
  })
);

// ── CORS (Phase A) ────────────────────────────────────────────────────────
// ALLOWED_ORIGINS is required in production (env-validation.ts enforces this).
// In development without ALLOWED_ORIGINS, all origins are allowed with a warning
// logged once at startup (see index.ts).
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins = rawAllowedOrigins
  ? rawAllowedOrigins.split(",").map((s) => s.trim()).filter(Boolean)
  : null;

app.use(
  cors({
    exposedHeaders: ["X-Server-Version", "X-Min-Client-Version", "X-Version-Warning"],
    origin: allowedOrigins
      ? (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error(`CORS: origin ${origin} not allowed`));
          }
        }
      : true,
    credentials: true,
  })
);

// ── Static service image storage (Phase 7.10) ─────────────────────────────
// Serves locally-stored, resized/compressed service images and thumbnails.
app.use(STORAGE_PUBLIC_PREFIX, express.static(getStorageRoot(), { maxAge: "7d", immutable: true }));

// ── Body parsing ──────────────────────────────────────────────────────────
// Webhook route must receive the raw body buffer so we can compute the
// X-Hub-Signature-256 HMAC. Capture it as raw bytes BEFORE the global
// JSON parser runs (express skips re-parsing once req.body is set).
app.use(
  "/api/webhooks",
  express.raw({ type: "application/json", limit: "1mb" })
);
// All other routes use the normal JSON parser.
app.use(express.json({ limit: "1mb" }));

// ── Version middleware ────────────────────────────────────────────────────
app.use(versionMiddleware);

// ── Per-route rate limiters ───────────────────────────────────────────────
// Applied before the router so limits cover all matching paths.

// Demo login: generous limit — must be registered BEFORE authLimiter
app.use("/api/auth/demo-login", demoLimiter);

// Auth endpoints: strict brute-force protection (skips /demo-login path internally)
app.use("/api/auth", authLimiter);

// Password reset: separate stricter limiter to protect email budget
app.use("/api/auth/forgot-password", passwordResetLimiter);
app.use("/api/auth/reset-password", passwordResetLimiter);

// Admin endpoints: internal only, tightest limits
app.use("/api/admin", adminLimiter);

// Webhooks: Meta sends bursts, allow higher throughput
app.use("/api/webhooks", webhookLimiter);

// Recovery/backup endpoints: expensive ops, tightest throttle
app.use("/api/recovery", recoveryLimiter);

// Owner management routes: workers, branches, expenditures, settings
app.use("/api/workers", ownerLimiter);
app.use("/api/branches", ownerLimiter);
app.use("/api/expenditures", ownerLimiter);
app.use("/api/batches", ownerLimiter);
app.use("/api/subscription", ownerLimiter);

// All other API endpoints: general rate limit
app.use("/api", apiLimiter);

// ── Routes ────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Phase C: Global error handler middleware ──────────────────────────────
// Must be defined AFTER all routes (Express requires 4-arg error handlers).
// Catches any error thrown or passed to next(err) from route handlers.
// Never leaks internal details to clients.
app.use(
  (
    err: Error,
    req: AuthRequest & { requestId?: string },
    res: Response,
    _next: NextFunction
  ) => {
    const statusCode = (err as any).status ?? (err as any).statusCode ?? 500;
    const requestId = req.requestId;
    const laundryId = req.auth?.laundryId;

    logError("[global-error-handler] Unhandled error", err, {
      requestId,
      laundryId,
      endpoint: req.path,
      method: req.method,
      statusCode,
    });

    // Persist to error_log table (non-blocking)
    trackError(err, {
      requestId,
      laundryId,
      endpoint: req.path,
      method: req.method,
      statusCode,
    }).catch(() => {});

    if (res.headersSent) return;

    res.status(statusCode).json({
      error:
        statusCode < 500
          ? err.message
          : "An unexpected error occurred. Our team has been notified.",
      ...(requestId ? { requestId } : {}),
    });
  }
);

export default app;
