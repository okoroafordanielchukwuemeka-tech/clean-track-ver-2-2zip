---
name: Global Search
description: Architecture and constraints for the GET /api/search global search endpoint
---

## Rule
Receipt numbers live on `paymentRecords.receiptNumber`, NOT on orders. Never add a `receiptNumber` column to orders.

**Why:** The data model intentionally separates payment records from orders. A single order can have multiple payments, each with its own receipt number.

## How to apply
When searching receipts, query `paymentRecords` with `ilike(paymentRecords.receiptNumber, pattern)`.

## Auth pattern
`AuthPayload.type` is `"owner" | "worker"` — NOT `role`. Use `req.auth!.type === "owner"` to check owner access.

## Branch isolation
`getEffectiveBranchId(req)` is a private function in `analytics.ts` (not exported). Copy it inline into any new route that needs branch isolation — same logic: `req.auth!.branchId ?? parseInt(req.query.branchId)`.

## Drizzle and()/or() safety pattern
Build conditions as `SQL[]` arrays, push conditionals only when defined, then `and(...conditions)`. Never pass `undefined` inline into `and()`.

## Owner-only search categories
Workers must NEVER receive workers/services/branches search results. Gate with `if (req.auth!.type === "owner")` before those queries.

## Schema facts
- `customers.fullName` (not `name`)  
- `services` has no `archived` column — only `isActive: boolean`  
- `workers.deletedAt` exists  
- `orders` has no `deletedAt` or `receiptNumber`
