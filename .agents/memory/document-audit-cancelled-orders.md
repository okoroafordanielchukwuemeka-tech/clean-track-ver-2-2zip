---
name: Cancelled-order pricing & A4 print width
description: Two real bugs found in the Phase 7.3 document audit and how they were fixed — cancelled-order financial leakage across receipts, and a mis-scoped A4 print width.
---

**Cancelled-order pricing:** `computeOrderPricing()` (shared by Order/Payment/Pickup Receipt) originally ignored `order.status`, so a cancelled order still showed its full pre-cancellation `totalDue`/`balance` on receipts, while the Customer Statement already zeroed it. This meant receipts and the statement never reconciled for a cancelled order with a prior payment.

**Why:** There is no soft-delete on `orders` (only `branches`/`customers`/`payment-records`/`workers` have `deletedAt`) — `DELETE /orders/:id` just sets `status="cancelled"`. Any pricing helper that reads order data must treat `status === "cancelled"` explicitly; it will never be filtered out at the query level.

**How to apply:** `computeOrderPricing()` now accepts optional `status`, zeroes `basePrice`/`extraCharge`/`discount`/`totalDue` when cancelled (mirroring the Statement), keeps `amountPaid` as historical fact, and returns `isCancelled`. All three receipt call sites (`receipts.ts`, `orders.ts` `/receipt`, `pickups.ts` `/receipt`) already pass full order rows so `status` flows through automatically — no call-site changes needed beyond destructuring `isCancelled` into the response. Frontend (`receipt-view.tsx`, `pickup-receipt-view.tsx`) shows a "CANCELLED" notice when `order.status === "cancelled"`.

**A4 print width:** `.print-format-a4 .receipt-root` inside `@media print` was capped at `480px` (a leftover copy-paste from the 58mm/80mm width), so switching print format to A4 never actually used the page — it rendered as a narrow receipt-width column with huge margins. Fixed to `max-width: 190mm`. Any future print-format CSS should be spot-checked with a real screenshot per format, not assumed correct from the class name.
