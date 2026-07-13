---
name: Document Generation Audit & Standardization
description: Shared order-pricing utility and Pickup Receipt architecture for CleanTrack's printable documents
---

All order-level financial math (basePrice + extraCharge - discount = totalDue; balance = max(0, totalDue - amountPaid)) must go through `computeOrderPricing()` in `artifacts/api-server/src/lib/order-financials.ts`. Never re-derive it inline in a new route.

**Why:** Order Receipt, Payment Receipt, and Pickup recording each had independent copies of this formula before the audit. They were functionally identical at audit time, but any future one-off fix (rounding, cancelled-order handling) risks silently desyncing the documents customers see.

**How to apply:** Any new document, report, or endpoint that shows an order's price/balance imports `computeOrderPricing(order)` instead of writing `parseFloat(order.price || "0") + ...`. The Customer Statement's ledger/running-balance engine is intentionally NOT merged into this — it's a different aggregation model (chronological entries) that was separately verified to reconcile with the simple per-order formula in aggregate.

Pickup Receipt (new) lives at `GET /orders/:orderId/pickups/:pickupId/receipt` (mounted under the mergeParams `pickupsRouter`) and the print route `/orders/:orderId/pickups/:pickupId/print`. Printable documents share `.receipt-*` CSS classes in `index.css` with format toggle classes `print-format-58mm|80mm|a4` (thermal default is 80mm; A4 widens for tabular docs). A placeholder (non-scannable) barcode pattern is rendered client-side from the receipt/pickup number — no barcode library dependency.
