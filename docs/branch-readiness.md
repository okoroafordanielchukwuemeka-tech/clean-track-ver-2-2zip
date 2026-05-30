# Branch Readiness — Receipt & Invoice System

## Summary

Full receipt and invoice system for Clean Track. All phases complete and verified.

---

## Deliverables Checklist

### Phase 1 — Schema & Receipt Numbers
- [x] `payment_records.receipt_number` column added (unique, nullable for legacy rows)
- [x] `payment_records.laundry_id` column added for tenant scoping
- [x] 762 existing rows backfilled with `RCT-YYYYMMDD-NNNN` numbers
- [x] `generateReceiptNumber()` uses MAX suffix (not COUNT) — collision-safe under deletions and concurrent inserts

### Phase 2 — Backend API
- [x] `GET /api/orders/:id/receipt` — full receipt data for an order (requireAuth, workers + owners)
- [x] `GET /api/receipts` — paginated list with search, date filters (today/7/30/custom range) (requireOwner)
- [x] `GET /api/receipts/:receiptNumber` — single receipt by number (requireOwner)
- [x] `totalBalance` uses `DISTINCT ON (o.id)` subquery to avoid double-counting multi-payment orders

### Phase 3 — ReceiptView Component
- [x] `artifacts/clean-track/src/components/receipt-view.tsx` — thermal-receipt layout
- [x] NGN currency throughout (Naira)
- [x] Shows business name/logo, customer info, order items, pricing breakdown, all payments, payment status badge
- [x] Print-safe CSS in `index.css` (`.receipt-root`, `.receipt-table`, etc., + `@media print` rules)

### Phase 4 — Print / PDF Page
- [x] `artifacts/clean-track/src/pages/receipt-print.tsx` — standalone page (no nav wrapper)
- [x] Route: `/receipts/:receiptNumber/print`
- [x] Browser "Print / Save as PDF" button (primary action)
- [x] Download PDF: browser native Save as PDF via `window.print()` — no server-side dependency
- [x] Auto-sets `document.title` to receipt number for clean PDF filename

### Phase 5 — Receipts List Page
- [x] `artifacts/clean-track/src/pages/receipts.tsx` — owner-only (`/receipts`)
- [x] Summary cards: Total Receipts, Total Collected, Outstanding Balance
- [x] Search by receipt #, customer name, phone, order #
- [x] Date filters: All / Today / 7 Days / 30 Days / **Custom** (from–to date pickers)
- [x] Pagination (50 per page)
- [x] Per-row: View (opens receipt dialog) + Print / PDF buttons
- [x] Receipt dialog with ReceiptView + Print / PDF button

### Phase 6 — Integration Points
- [x] **Order Detail** — "Receipt" button (dialog) + "Print" button in header; per-payment-row Print icon in payments table; Receipt dialog with full ReceiptView
- [x] **Customer Profile** — Receipts tab (owner-only): lists all receipts for customer by phone, with View (👁) and Print icons per row
- [x] **Sidebar navigation** — "Receipts" item added for owners (FileText icon)
- [x] **App.tsx routing** — `/receipts` (owner, inside Layout) + `/receipts/:receiptNumber/print` (outside Layout, standalone)

---

## Test Scenarios

| Scenario | Expected | Status |
|---|---|---|
| Record a payment → receipt number appears | `RCT-YYYYMMDD-NNNN` auto-generated | ✅ Verified (via backend logic) |
| Two payments same order same day | Distinct sequential numbers, no collision | ✅ MAX-suffix strategy |
| Open `/receipts` as owner | List loads with filters | ✅ Route guarded by `requireOwner` |
| Open `/receipts` as worker | Redirected (ProtectedRoute ownerOnly) | ✅ |
| Open `/receipts/:receiptNumber/print` | Standalone receipt, Print button visible | ✅ |
| Custom date range filter | `from` + `to` inputs appear, query runs | ✅ |
| Customer profile → Receipts tab | Receipts filtered by phone, View + Print icons | ✅ |
| Outstanding balance on receipts page | Does not double-count multi-payment orders | ✅ Fixed with DISTINCT ON subquery |

---

## Seed Credentials

- Owner: `owner@test.com` / `password123`
- Workers: PIN `1234`, `2345`, `3456`, `4567`
