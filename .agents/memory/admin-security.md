---
name: Admin Security & Impersonation
description: Role system, audit logging, impersonation flow, and rate limiting for the platform admin layer
---

## Role System
- `role` column added to `platform_admins` table: `super_admin | support_admin | finance_admin`
- Default: `super_admin` (backward-compatible — existing admin rows get this)
- `requireSuperAdmin` middleware in `admin-auth.ts` blocks support/finance from write routes
- Role is embedded in the admin JWT and displayed in the admin sidebar

## Admin Audit Log
- Table: `admin_audit_log` (27th table in schema)
- Fields: adminId, adminName, adminEmail, action, targetLaundryId, targetLaundryName, metadata (JSONB), ipAddress, createdAt
- Helper: `artifacts/api-server/src/lib/admin-audit.ts` → `logAdminAction(opts)`
- Logged actions: admin_login, impersonate_tenant, plan_change, status_change, trial_extend, suspend, activate, cancel
- Subscription write routes already log to `subscription_logs` with `changedBy: "admin:${name}"`

## Impersonation Flow
- Endpoint: `POST /api/admin/tenants/:id/impersonate` (requireAdmin)
- Returns: 2h short-lived owner JWT with `impersonatedBy: { adminId, adminName, adminEmail }` embedded
- `signImpersonationToken()` in admin-auth.ts merges owner payload + impersonatedBy field
- Frontend: `startImpersonation(token)` backs up `ct_admin_token` to `ct_admin_impersonation_backup`, sets `ct_token`, redirects to /dashboard
- `ImpersonationBanner` component decodes `ct_token` at render time, shows orange banner if impersonatedBy present
- Exit: clears `ct_token`, restores backup, redirects to /admin
- Every impersonation call is written to `admin_audit_log` before the token is returned

## Rate Limiting
- Admin login: `adminLoginLimiter` — 10 attempts per 15 minutes per IP
- Uses same `express-rate-limit` v8 package already in the project (trust proxy already set in app.ts)

## Security Properties
- Admin JWT uses `type: "admin"` — owner/worker tokens (`type: "owner"/"worker"`) are rejected by `requireAdmin` with 403
- Both token types share JWT_SECRET (acceptable for dev; consider separate secret for hardening)
- Impersonation token has `type: "owner"` so it works transparently through `requireAuth`

**Why:** Needed for Paystack launch — support staff need to debug customer issues without knowing their password; audit trail is required for any SaaS charging real money.
