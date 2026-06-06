---
name: Plan Limit Enforcement
description: How hard plan limits and usage warnings are implemented across the stack
---

# Plan Limit Enforcement System

## Core Service
`artifacts/api-server/src/lib/usage-service.ts` — computes live usage from DB truth:
- `computeUsage(laundryId)` — returns raw counts (monthly orders, active workers, active branches, storage estimate)
- `computeUsageWithLimits(laundryId, plan)` — enriches with limits, percentages (0-100+), and warning levels
- `checkLimit(laundryId, plan, limitType)` — returns null or `{ code, message }` for enforcement
- Storage estimated as `totalOrders × 2KB / 1024` (no file uploads in app)
- `MAX_STORAGE_MB_BY_PLAN`: free=500, starter=2048, pro=10240, business=51200

**Why live DB queries:** No counter columns needed; self-healing; always accurate; avoids drift from soft deletes or restores.

## Hard Enforcement Middleware
`requirePlanLimit(limitType)` exported from `artifacts/api-server/src/middleware/subscription.ts`.
Returns HTTP 403 with `{ error: string, code: "PLAN_LIMIT_*_REACHED" }`.

**Plugged into:**
- `POST /orders` — after `requireOperational`, before `checkPermission("process:orders")` and `idempotencyMiddleware`
- `POST /workers` — after `requireOperational`
- `POST /branches` — after `requireOperational`

## Warning Levels
`"safe" | "warning_70" | "warning_85" | "critical_100"` (thresholds: ≥70%, ≥85%, ≥100%)

## Alert Rules
Alert engine (`artifacts/api-server/src/lib/alert-engine.ts`) runs usage checks for each active/trial tenant.
4 resource types × 3 thresholds = 12 usage alert fingerprints per laundry:
- Pattern: `usage:{resource}_{pct}:{laundryId}` (e.g. `usage:orders_100:42`)
- Only resolves lower-tier alerts when a higher-tier fires (prevents duplicate warnings)

**Why:** Alert engine already runs on a 5min scheduler — usage alerts are computed inside `runAlertChecksForLaundry()` and share the same scheduling infrastructure.

## Owner Billing Dashboard
`GET /api/subscription/usage` (requireOwner) — returns `UsageWithLimits`.
Settings page → Billing & Usage section shows 4 usage bars with warning badges.
Dashboard `SubscriptionBanner` shows inline usage warning bars if any dimension ≥70%.

## Admin Tenant View
`GET /api/admin/tenants` now returns `usage.percentages`, `usage.limits`, `usage.highestPct` per tenant.
Admin command center TenantsTab shows mini usage bars per tenant row + sort by "Highest Usage" option.
Alert banners show count of tenants at limit (≥100%) vs near limit (≥85%).
