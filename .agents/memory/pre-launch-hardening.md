---
name: Pre-launch Hardening
description: Security hardening decisions made for production readiness — rate limiting, env validation, backup automation, helmet.
---

## express-rate-limit v8 and trust proxy

express-rate-limit v8 throws `ERR_ERL_KEY_GEN_IPV6` at module init time if any limiter uses a custom `keyGenerator` that reads `req.ip` without going through the library's IPv6 helper — OR if `trust proxy` is not configured and the default key generator encounters an IPv6 address like `::1`.

**Fix**: Add `app.set("trust proxy", 1)` in app.ts BEFORE creating the Express app's rate limiter middleware. This makes `req.ip` return the real forwarded IP. Do NOT write a custom `keyGenerator` that reads `req.ip` directly.

**Why**: Replit (and most cloud providers) run behind a reverse proxy. Without trust proxy, `req.ip` returns `::ffff:127.0.0.1` or `::1`, which triggers the v8 validation error.

## Environment secrets architecture

- `SESSION_SECRET` — stored as a **Replit Secret** (not a shared env var). Setting it via `setEnvVars` causes a conflict error: "already set up as secrets".
- `BACKUP_SECRET` — stored as a **shared env var** via `setEnvVars({ environment: "shared" })`.
- `JWT_SECRET` — already a shared env var from project inception.
- `DATABASE_URL` — already a shared env var.

## env-validation.ts startup guard

`validateEnvironment()` must be the very first import in `index.ts` (before importing `app.ts`), using a top-level import assignment pattern:

```ts
import { validateEnvironment } from "./lib/env-validation.js";
validateEnvironment();      // crashes process if any required var is missing
import app from "./app.js"; // app.ts is imported AFTER validation
```

This ensures helmet, rate-limiters, and all other modules never even initialize if secrets are absent.

## API client (api.ts) extension pattern

New backend endpoints need a matching entry in `artifacts/clean-track/src/lib/api.ts` inside the `export const api = { ... }` object. The `request()` function is internal — frontend components must go through the `api.*` namespace.

Pattern for adding a new namespace:
```ts
health: {
  production: () => request<ProductionHealthData>("GET", "/health/production"),
},
```

## Platform Health page route

- Frontend route: `/platform-health` (ownerOnly ProtectedRoute)
- Backend endpoint: `GET /api/health/production` (requireOwner)
- Nav item: "Platform Health" with ShieldCheck icon, inserted before "Settings" in ownerNavItems
- Auto-refreshes every 60 seconds
- Returns: api status, db latency/size, backup age+HMAC, open alerts, device heartbeats, sync queue, business metrics

## Backup scheduler

- Daily at 02:00 UTC via setTimeout (no cron dependency)
- HMAC-signs manifest with BACKUP_SECRET using `crypto.createHmac("sha256", secret)`
- On failure: fires an alert in the `alerts` table for all active laundries
- Off-site adapters (R2, S3, B2) are stubbed interfaces — activate by calling `setOffSiteAdapter()`
- Registered in index.ts AFTER env validation passes
