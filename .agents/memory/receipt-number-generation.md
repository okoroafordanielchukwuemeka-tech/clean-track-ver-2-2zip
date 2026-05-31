---
name: Receipt Number Generation
description: How receipt numbers are generated and the Drizzle sql.raw() requirement for SUBSTRING FROM position
---

## The Rule
In `generateReceiptNumber()`, the SUBSTRING start position must be embedded using `sql.raw(String(n))` — never as a plain `${n}` interpolation in a Drizzle `sql` template tag.

## Why
Drizzle's `sql` template tag binds all `${}` values as prepared statement parameters (`$1`, `$2`, …). PostgreSQL's `SUBSTRING(text FROM $2)` accepts a parameterized position BUT when the value is bound as a numeric literal that gets cast through the SQL planner, it silently misinterprets it — returning MAX = -1 or 0 instead of the real max suffix. This causes `generateReceiptNumber()` to always return `RCT-YYYYMMDD-0001`, which is already taken after the first payment, making every subsequent payment insert fail with a unique constraint violation.

## How to Apply
```typescript
const fromPos = prefix.length + 1; // e.g. 14 for "RCT-20260531-"
sql<number>`COALESCE(MAX(CAST(SUBSTRING(${col} FROM ${sql.raw(String(fromPos))}) AS INTEGER)), 0)`
```

Also: the retry loop passes `attempt` as an `offset` parameter so each retry candidate is `MAX + 1 + attempt`, preventing re-collision when the seed has created many receipts on the same date.

## Seed note
The demo seed (scripts/seed-demo.ts) creates all orders and payments on the current date, so it may produce 800+ receipts on a single day. `generateReceiptNumber(offset)` handles this correctly once `sql.raw()` is used.
