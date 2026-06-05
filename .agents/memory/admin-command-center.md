---
name: Admin Command Center
description: Platform-level CleanTrack admin portal — separate from laundry owner dashboard
---

# Admin Command Center

## Architecture
- **Separate auth** — `platform_admins` table (24th), JWT payload `{ type: "admin", adminId, email, name }`
- **Middleware** — `requireAdmin` in `artifacts/api-server/src/middleware/admin-auth.ts`; checks `payload.type === "admin"`
- **Routes** — `GET/POST /api/admin/*` registered at the bottom of routes/index.ts
- **Frontend** — `/admin/login` and `/admin` routes in App.tsx, wrapped in `AdminProvider` context
- **Admin seeding** — `scripts/seed-admin.ts`, credentials: `admin@cleantrack.internal` / `Admin@CleanTrack1`

## API Endpoints (all require admin JWT)
- `POST /api/admin/auth/login` — public, no auth
- `GET /api/admin/overview` — platform-wide counts (tenants, orders, devices, alerts, DB size)
- `GET /api/admin/tenants` — per-tenant health with stats; `GET /api/admin/tenants/:id` for detail
- `GET /api/admin/devices` — all heartbeats across all laundries with status (online/stale/offline)
- `GET /api/admin/storage` — table sizes + exact row counts + scale projections
- `GET /api/admin/backups` — per-tenant snapshot health (healthy/warning/critical)

## Critical Quirk — Table Size Queries
**Never use `pg_stat_user_tables.tablename` inside function calls in Drizzle `sql` template** — Drizzle fails with `column "tablename" does not exist` even though it's valid SQL.

**Fix:** Use `pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'` and call `pg_total_relation_size(c.oid)` using the OID directly. This bypasses the column-reference issue entirely.

**Why:** Drizzle's `sql` template escaping interferes with identifier resolution when column names from system catalog views are used inside SQL function call arguments.

## Frontend Structure
- `artifacts/clean-track/src/context/admin-context.tsx` — AdminProvider, useAdmin hook, localStorage keys `ct_admin_token` / `ct_admin_user`
- `artifacts/clean-track/src/pages/admin-login.tsx` — dark purple themed login
- `artifacts/clean-track/src/pages/admin-command-center.tsx` — 5-tab dashboard with sidebar nav
- Admin has completely separate session from laundry owner — uses different localStorage keys

## Security
- Owner JWT (type="owner") is rejected at `requireAdmin` — `Admin access required` 403
- Admin JWT is NOT accepted at `requireOwner` routes — completely separate token types
- Admin can see ALL tenants' data (no laundryId scoping on admin routes, by design)
