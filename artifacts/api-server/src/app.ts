import express from "express";
import cors from "cors";
import helmet from "helmet";
import { router } from "./routes/index.js";
import { versionMiddleware } from "./middleware/version.js";
import {
  authLimiter,
  apiLimiter,
  webhookLimiter,
  adminLimiter,
} from "./lib/rate-limiter.js";

const app = express();

// ── Trust proxy (Replit runs behind a reverse proxy) ─────────────────────
// Required for req.ip to return the real client IP (not ::1/::ffff:127.0.0.1)
// and for express-rate-limit v8 to generate keys correctly.
app.set("trust proxy", 1);

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

// ── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

// ── Version middleware ────────────────────────────────────────────────────
app.use(versionMiddleware);

// ── Per-route rate limiters (Phase E) ─────────────────────────────────────
// Applied before the router so limits cover all matching paths.

// Auth endpoints: strict brute-force protection
app.use("/api/auth", authLimiter);

// Admin endpoints: internal only, tightest limits
app.use("/api/admin", adminLimiter);

// Webhooks: Meta sends bursts, allow higher throughput
app.use("/api/webhooks", webhookLimiter);

// All other API endpoints: general rate limit
app.use("/api", apiLimiter);

// ── Routes ────────────────────────────────────────────────────────────────
app.use("/api", router);

export default app;
