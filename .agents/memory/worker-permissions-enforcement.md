---
name: Worker Permissions Enforcement
description: How worker permission fields are enforced across API routes and the JWT; middleware ordering rule.
---

## Rule
`checkPermission(perm)` middleware MUST be placed BEFORE `idempotencyMiddleware` on every mutating route (POST/PATCH). If idempotencyMiddleware runs first it calls `next()` (pass-through when no header present), allowing the handler to run and return a 400 — masking the 403 that should fire.

**Why:** `idempotencyMiddleware` is pass-through when the `Idempotency-Key` header is absent (for compatibility with direct API calls and tests). So ordering `idempotencyMiddleware, checkPermission` means unauthorized workers hit the handler before permission is checked.

**How to apply:** On every POST/PATCH route: `router.post("/", checkPermission("perm"), idempotencyMiddleware, handler)`.

## WorkerPermissions type (8 fields)
Stored in `workerPermissions` DB table and embedded in the JWT at login:
- `canViewOrders`, `canProcessOrders`, `canRecordPayments`, `canRecordPickups`
- `canViewCustomers`, `canCreateCustomers`, `canViewCustomerBalances`, `canAssignOrders`

ADMIN_DEFAULT_PERMISSIONS: all true. WORKER_DEFAULT_PERMISSIONS: all false.

## JWT embedding
Worker-login route fetches/upserts the `workerPermissions` row and embeds it in the JWT payload under `permissions`. Owners bypass all checks. Workers without `permissions` in JWT (old tokens) are denied by default (safest).

## Permission → field mapping (in permissions.ts WORKER_PERM_FIELD)
- view:orders → canViewOrders
- process:orders → canProcessOrders
- record:payments → canRecordPayments
- record:pickups → canRecordPickups
- view:customers → canViewCustomers
- create:customers → canCreateCustomers
- view:customer-balances → canViewCustomerBalances
- assign:orders → canAssignOrders

## Owner-only permissions (OWNER_ONLY set)
delete:orders, delete:payments, modify:order-items, edit:customer-identity, delete:customers — always return 403 for workers.

## assign:orders field-level guard
`canAssignOrders` enforced as an INLINE check inside the PATCH /orders/:id handler body (not middleware), because the route also requires `canProcessOrders` via middleware — the inline guard only kicks in when `assignedWorkerId` is present in the request body.

## Frontend
- `hasPermission(perm)` in auth-context returns true for owners, checks `user.permissions?.[perm] ?? false` for workers.
- Buttons/tabs gated: payment button (canRecordPayments), pickup card (canRecordPickups), New Customer (canCreateCustomers), Receipts/Statement tabs (canViewCustomerBalances).

## Validation
Workers re-login required after permission changes (JWT is 12h, acceptable trade-off). 37/37 enforcement checks pass.
