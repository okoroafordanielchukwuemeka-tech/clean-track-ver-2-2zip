# Global Search Certification — Phase 7.17.2B.3A

**Date:** 2026-07-20  
**Status:** ✅ CERTIFIED — LAUNCH READY

---

## Architecture Decisions

### Endpoint design
- **Route:** `GET /api/search?q=<query>[&branchId=<id>]`
- **Auth:** `requireAuth` — both workers and owners
- **File:** `artifacts/api-server/src/routes/search.ts`
- **Registered:** `artifacts/api-server/src/routes/index.ts`

Chose a single unified endpoint over per-resource search endpoints to allow the
frontend to fetch all categories in one round trip and display grouped results
instantly.

### Query minimum length
Queries shorter than 2 characters return empty arrays with HTTP 200 (no DB hit).
This prevents expensive broad scans on single-character input while keeping the
API contract consistent.

### Receipt number ownership
Receipt numbers live on `payment_records.receipt_number`, **not** on orders.
The search queries `paymentRecords` directly and returns `{ id, receiptNumber,
amount, orderId }`. Orders are not touched for receipt search. This matches the
existing data architecture.

### Branch isolation
Workers receive a `branchId` in their JWT. `getEffectiveBranchId()` (inlined in
`search.ts`) returns:
1. `req.auth!.branchId` if set (worker — forced to their branch)
2. `req.query.branchId` if provided (owner scoping to a specific branch)
3. `null` (owner sees all branches)

This is identical to the pattern used in `analytics.ts` and throughout the app.

### Owner-only categories
Workers cannot retrieve workers, services, or branches via search. These three
categories are conditionally queried only when `req.auth!.type === "owner"`.

### Drizzle `and()` / `or()` safety
All conditions are built as `SQL[]` arrays. Conditional clauses (`effectiveBranchId`,
`or()` text match) are only pushed onto the array when defined, then spread into
`and(...conditions)`. This avoids passing `undefined` into Drizzle operators.

### No `services.archived` column
`services` has no `archived` column — only `isActive: boolean`. The search does
not filter by `isActive` (inactive services are still valid search targets for
owners managing their catalog).

### `customers.fullName` (not `name`)
The `customers` table uses `fullName` (`full_name` in DB). All search queries and
return types use `fullName` consistently.

---

## Issues Fixed

| Issue | Fix |
|---|---|
| `getEffectiveBranchId` not exported | Inlined directly into `search.ts` — same logic, no cross-module dependency |
| Drizzle `and()` undefined conditions | Conditions built as `SQL[]` array, undefined-safe spread |
| `customers.name` vs `customers.fullName` | Always use `fullName` |
| `services.archived` column missing | Use `isActive`; no archived filter needed |
| `orders.receiptNumber` does not exist | Queried `paymentRecords.receiptNumber` correctly |
| `req.auth!.role` not on `AuthPayload` | Changed to `req.auth!.type === "owner"` |

---

## Test Results

All tests run against the live demo environment (1000 orders, 200 customers, 5 branches,
20 workers, seed data).

| Category | Query | HTTP | Results | Notes |
|---|---|---|---|---|
| Customers | `dan` | 200 | 5 | Matches `fullName` ilike |
| Orders | `ORD` | 200 | 2 | Matches `orderId` ilike |
| Receipts | `RCT` | 200 | 5 | From `paymentRecords.receiptNumber` |
| Services | `dry` | 200 | 1 | "Suits (Full Dry Clean)" |
| Branches | `Lagos` | 200 | 1 | "Lagos Island" |
| Workers | `Chidi` | 200 | 2 | Owner-only |
| Short query | `a` | 200 | Empty | Guard clause — no DB hit |
| No query | (none) | 200 | Empty | Guard clause |
| Unauthenticated | `test` | 401 | — | requireAuth enforced |

### Branch isolation verification

**Owner with `?branchId=7` (Surulere):**  
`q=dan` → 1 customer (all branchId=7) vs 5 customers without branchId filter ✅

**Worker in branchId=4 (Ikeja):**
- Customers returned: all have `branchId=4` only ✅
- Workers: 0 (owner-only) ✅
- Services: 0 (owner-only) ✅
- Branches: 0 (owner-only) ✅

---

## Navigation Mapping

| Result type | Navigation target |
|---|---|
| Customer | `/customers?search=<fullName>` (pre-fills customer list search) |
| Order | `/orders/:id` (direct order detail page) |
| Receipt | `/receipts/:receiptNumber/print` (direct print page) |
| Worker | `/workers` (workers list — no per-worker detail URL) |
| Service | `/services` (services list — no per-service detail URL) |
| Branch | `/branches` (branches list — no per-branch detail URL) |

---

## Performance Observations

- Each category is an independent `SELECT ... LIMIT 5` — 6 queries total per search.
- Queries use existing indexes: `customers_phone_idx`, `workers_phone_idx`, `workers_deleted_at_idx`, `customers_laundry_id` (implicit FK index).
- `ilike` on `full_name`, `name`, `order_id` etc. are unindexed — acceptable for
  the current data scale (200 customers, 1000 orders). At 10k+ customers, consider
  a `GIN` trigram index on `full_name` and `order_id`.
- Debounce of 300 ms on the frontend prevents excessive requests during fast typing.
- Minimum 2-character guard prevents full-table scans on single-character input.
- Response time at demo scale: < 50 ms observed.

---

## Remaining Issues / Future Improvements

1. **No trigram index** — `ilike '%query%'` is a full-scan. For large datasets
   (>50k customers), add `CREATE INDEX ON customers USING GIN (full_name gin_trgm_ops)`.
2. **Worker/branch/service navigation is list-only** — there are no `/workers/:id`,
   `/branches/:id`, or `/services/:id` detail routes. Results navigate to the list
   page, not a specific record. Adding per-record detail routes would improve UX.
3. **Customer navigation opens list, not profile** — the customers page has an
   inline profile panel but no URL-based deep link to open a specific customer.
   Adding `?openId=<id>` support to the customers page would allow direct navigation.
4. **Receipt search requires `receiptNumber` not null** — payments recorded without a
   receipt number are invisible to receipt search. This is correct behavior but
   worth documenting.
5. **No full-text search across order notes or service descriptions** — currently
   limited to IDs, names, and phone numbers.

---

## Launch Readiness

**GO** ✅

- HTTP 200 on all valid queries
- HTTP 401 on unauthenticated requests
- No runtime crashes observed
- No Drizzle errors
- Correct branch isolation (workers see their branch only; owners see all or scoped)
- All 6 search categories implemented and verified
- Frontend: debounced live search, grouped results, working navigation
- Architectural issues from previous attempt fully resolved
