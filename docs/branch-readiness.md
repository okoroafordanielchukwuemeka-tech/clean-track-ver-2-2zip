# Branch Readiness — Receipt & Invoice System

## Deliverables Checklist

### Phase 1 — Schema & Receipt Numbers
- [x] `payment_records.receipt_number` column added (unique, nullable for legacy rows)
- [x] `payment_records.laundry_id` column added for tenant scoping
- [x] 762 existing rows backfilled with `RCT-YYYYMMDD-NNNN` numbers
- [x] `generateReceiptNumber()` uses MAX suffix (not COUNT) — collision-safe under deletions
- [x] Retry-on-unique-constraint loop (up to 5 attempts) guards concurrent INSERT collisions

### Phase 2 — Backend API
- [x] `GET /api/orders/:id/receipt` — full receipt data (requireAuth: workers + owners)
- [x] `GET /api/receipts` — paginated list with search + date filters (requireOwner)
- [x] `GET /api/receipts/:receiptNumber` — single receipt by number (requireOwner)
- [x] `GET /api/customers/:id/receipts` — customer-scoped receipts list (requireAuth: workers + owners)
- [x] `totalBalance` uses `DISTINCT ON (o.id)` subquery — no double-counting for multi-payment orders

### Phase 3 — ReceiptView Component
- [x] `artifacts/clean-track/src/components/receipt-view.tsx` — thermal-receipt layout
- [x] NGN currency throughout (Naira, `en-NG` locale)
- [x] Business name/logo, customer info, order items, pricing breakdown, all payments, payment status badge
- [x] Print-safe CSS in `index.css` + `@media print` rules

### Phase 4 — Print / PDF Page
- [x] `artifacts/clean-track/src/pages/receipt-print.tsx` — standalone page (no nav wrapper)
- [x] Route: `/receipts/:receiptNumber/print`
- [x] "Print / Save as PDF" button using `window.print()` (browser native PDF)
- [x] `document.title` set to receipt number for clean PDF filename

### Phase 5 — Receipts List Page
- [x] `artifacts/clean-track/src/pages/receipts.tsx` — owner-only (`/receipts`, `ProtectedRoute ownerOnly`)
- [x] Summary cards: Total Receipts, Total Collected, Outstanding Balance
- [x] Search by receipt #, customer name, phone, order #
- [x] Date filters: All / Today / 7 Days / 30 Days / **Custom** (from–to date pickers)
- [x] Pagination (50 per page)
- [x] Per-row: View (receipt dialog) + Print / PDF buttons

### Phase 6 — Integration Points
- [x] **Order Detail** — Receipt dialog (ReceiptView) + Print/PDF button in header; per-payment Print icon
- [x] **Customer Profile** — Receipts tab (all users): calls `GET /customers/:id/receipts`; View + Print icons per row
- [x] **Sidebar** — "Receipts" nav item for owners
- [x] **App.tsx** — `/receipts` (owner, inside Layout) + `/receipts/:receiptNumber/print` (standalone)

---

## Per-Table Impact Analysis

### `payment_records`
- **New columns**: `receipt_number` (unique, varchar), `laundry_id` (FK to laundries)
- **Backfill**: 762 existing rows assigned `RCT-YYYYMMDD-NNNN` via raw SQL
- **Unique constraint**: `payment_records_receipt_number_unique` — enforces no duplicate receipt numbers across the system
- **Multi-branch readiness**: `laundry_id` already scopes all receipt queries; a future `branch_id` FK can be added as an additional scope without breaking existing queries
- **API impact**: All receipt endpoints filter by `laundryId` from auth token — branch-safe as long as token carries branchId

### `orders`
- **No schema changes** in this phase
- **Multi-branch readiness**: Orders already carry `laundry_id`; `branch_id` addition would require JOIN updates in receipt aggregate queries (notably the `DISTINCT ON` outstanding-balance subquery in `GET /receipts`)

### `customers`
- **No schema changes** in this phase
- **New endpoint**: `GET /customers/:id/receipts` joins `payment_records` → `orders` via `orders.customer_id`; would need `branch_id` filter added alongside `laundry_id` for multi-branch support

### `workers` / `laundries`
- **No schema changes** in this phase
- Receipt generation and display uses `laundry.business_name`, `laundry.business_profile`, and `laundry.branding_settings` — these are laundry-level, not branch-level; branch branding would need a new table

### `expenditures` / `notifications`
- **Not touched** in this phase

---

## Access Control Summary

| Endpoint | Auth Level | Notes |
|---|---|---|
| `GET /orders/:id/receipt` | requireAuth | Workers + owners; scoped to laundry |
| `GET /customers/:id/receipts` | requireAuth | Workers + owners; verifies customer belongs to laundry |
| `GET /receipts` | requireOwner | Full list with financials — owner-only |
| `GET /receipts/:receiptNumber` | requireOwner | Single receipt detail — owner-only |
| `/receipts` page | ProtectedRoute ownerOnly | Frontend route guard |
| `/receipts/:receiptNumber/print` | No auth middleware (standalone page) | Requires token via API calls within page |

---

## Test Scenarios

| Scenario | Expected | Status |
|---|---|---|
| Record payment → receipt number generated | `RCT-YYYYMMDD-NNNN` auto-assigned | ✅ |
| Two concurrent payments same day | Retry loop resolves unique collision | ✅ |
| Worker opens order detail → Print receipt | Uses `/receipts/:receiptNumber/print` → `GET /orders/:id/receipt` (requireAuth) | ✅ |
| Worker opens customer profile → Receipts tab | Calls `GET /customers/:id/receipts` (requireAuth) | ✅ |
| Worker navigates to `/receipts` | Blocked by `ProtectedRoute ownerOnly` | ✅ |
| Owner uses Custom date range filter | from/to pickers appear; API receives `dateRange=custom&from=&to=` | ✅ |
| Outstanding balance on receipts page | No double-counting; uses DISTINCT ON subquery | ✅ |

---

## Final Report

### What Was Built
The complete Receipt & Invoice System for Clean Track covering Phases 1–6:
- Auto-generated receipt numbers on every payment (collision-safe, retry-hardened)
- Full receipt data API endpoints (order receipt, receipts list, receipt by number, customer receipts)
- Thermal-style ReceiptView component with NGN currency
- Standalone print/PDF page at `/receipts/:receiptNumber/print`
- Owner-only receipts list page with search, date filters (including custom date range), and pagination
- Receipt dialog + print buttons integrated into order detail page
- Receipts tab in customer profile modal (accessible to workers and owners)
- "Receipts" item added to owner sidebar navigation

### Bugs Fixed During Implementation
- `totalBalance` double-counting for multi-payment orders (fixed with `DISTINCT ON (o.id)` subquery)
- TypeScript type mismatches in `customers.tsx` (`limit/page` strings, `r.method` field name, null guard)
- Route path corrected to `/receipts/:receiptNumber/print` (was `/receipts/print/:receiptNumber`)
- Workers blocked from printing receipts — fixed via `GET /orders/:id/receipt` (requireAuth) + `GET /customers/:id/receipts` worker-accessible endpoint

### Known Limitations / Future Hardening
- Receipt number generation uses MAX-suffix + retry loop; for very high volume (100+ simultaneous payments) a DB-native sequence per laundry/day would be more robust
- Print/PDF uses browser `window.print()` — no server-side PDF generation; sufficient for most use cases
- Custom date range has no validation that `from` ≤ `to` (handled gracefully by SQL, returns empty set)

### Readiness Score: **9/10**
Fully functional, access-controlled, and NGN-formatted. Deduction for browser-only PDF (no server-side PDF) and no automated tests.

### Seed Credentials
- Owner: `owner@test.com` / `password123`
- Workers: PIN `1234`, `2345`, `3456`, `4567`
