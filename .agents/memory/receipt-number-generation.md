---
name: Receipt Number Generation
description: Production-safe atomic counter pattern — replaces old MAX()+1 retry loop.
---

## The Rule
Receipt numbers use `receipt_number_counters` table with an atomic `INSERT … ON CONFLICT DO UPDATE` counter. `generateReceiptNumber(tx)` MUST be called inside the same `db.transaction()` that inserts the payment record.

## Format
`RCT-YYYYMMDD-NNNN` — resets per calendar day, globally unique system-wide.

## Self-initialisation
On the first call for a given day the INSERT runs a `SELECT MAX(CAST(SUBSTRING(...)))` subquery over existing `payment_records` for that date prefix, so the counter starts above any already-stored receipts (handles seeded/legacy data). Subsequent calls do `ON CONFLICT DO UPDATE counter + 1` atomically.

**Why:** The old `MAX()+1` with retry loop has a TOCTOU race window that fails under concurrent inserts and across multiple Node processes. The counter-table pattern is serialised at the DB level.

**How to apply:**
- Always call `generateReceiptNumber(tx)` inside a `db.transaction()`.
- Cast `tx as unknown as typeof db` to satisfy TypeScript — this is intentional.
- The `sql.raw(String(n))` trick is still needed for the SUBSTRING position integer inside the initialisation query.
- Payment route uses `db.transaction()` with `SELECT … FOR UPDATE` on the order row.

## Payment route concurrency fix
`POST /orders/:id/payments` runs entirely inside `db.transaction()`:
1. `SELECT … FOR UPDATE` locks the order row
2. `generateReceiptNumber(tx)` inside same TX (counter rollback on failure)
3. INSERT payment_records
4. UPDATE orders.amount_paid

## Pickup route concurrency fix
`POST /orders/:orderId/pickups` runs entirely inside `db.transaction()` with `SELECT … FOR UPDATE` on the order. Item quantity validation + update both happen inside the TX, preventing concurrent pickups from double-counting quantities.

## Idempotency middleware fix
Replaced `check → process → insert` pattern with atomic reservation:
1. `INSERT pending ON CONFLICT DO NOTHING RETURNING`
2. First caller proceeds; second sees 409 (in-flight) or cached 201
3. On success: UPDATE to `completed` with response body
4. On error: DELETE pending row so retries can succeed
