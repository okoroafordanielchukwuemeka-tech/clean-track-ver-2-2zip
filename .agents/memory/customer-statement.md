---
name: Customer Statement Engine
description: Milestone 7.1 — corrected statement engine with opening balance, no double-counting, cancelled orders, voided payment exclusion, 5 period presets
---

## Rules

**Opening balance pre-query:** Queries all activity strictly before `fromDate`, computes net balance (orders + adjustments − payments) and passes it as `openingBalance` so the running ledger starts correctly. Adjustments on cancelled pre-period orders are skipped.

**No double-counting:** Order entries use `price` (base) only. Adjustments (`extra_charge`, `discount`) appear as separate ledger rows. Earlier bug: base price + adjustments in one entry then adjustments again = inflated balance.

**Cancelled orders:** `status === "cancelled"` → entry type `"cancelled"`, charge = 0. Adjustments on cancelled orders are skipped (no financial effect). Payment against a cancelled order still shows (may be a credit balance).

**Voided payments:** `isNull(paymentRecords.deletedAt)` on all payment queries (both pre-period and period). DB column `payment_records.deleted_at` is set by `DELETE /orders/:id/payments/:paymentId`.

**Period presets:** Frontend: `today | week | month | lastMonth | custom`. `stmtParams` computes ISO timestamps. Default is `month`.

**Summary fields:** `openingBalance`, `totalBaseCharges`, `totalExtraCharges`, `totalDiscounts`, `totalCharged` (= base + extra − disc), `totalPaid`, `closingBalance`, `orderCount`, `cancelledOrderCount`, `paymentCount`.

**Math invariant (always holds):** `closingBalance = openingBalance + totalCharged - totalPaid`

**Why:** Previous engine had 4 bugs: double-counting, cancelled orders charged full price, voided payments included, no opening balance. All four fixed in Milestone 7.1.

## Payment endpoint shape
`POST /orders/:id/payments` returns the payment object at **top level** (`r.id`, `r.amount`, `r.receiptNumber`), NOT nested under `r.payment`.

## Verified test results (against demo seed, July 2026)
- 6 math checks: 6/6 PASS
- Cancelled order + payment = credit balance: PASS
- Voided payment (`deleted_at` set) excluded from ledger: PASS (confirmed via psql)
- Running balance consistent across all entries: PASS
- Empty-period statement: closingBalance = openingBalance: PASS

## Auth rate limiter note
`/api/auth/owner-login` is limited to 10/15 min. For testing sequences, cache the token in a single Node.js process rather than re-calling login between steps.
