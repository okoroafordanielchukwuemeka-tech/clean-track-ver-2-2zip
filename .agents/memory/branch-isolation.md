---
name: Branch Isolation & Analytics Auth
description: How multi-branch security is enforced in the API; analytics auth pattern for worker access
---

## Branch isolation pattern (routes: orders, pickups, customers, discount-approvals)

All ID-based lookups enforce worker's branch via:
```ts
const workerBranchId = req.auth!.branchId;
const conditions = [eq(table.laundryId, laundryId), eq(table.id, id)];
if (workerBranchId) conditions.push(eq(table.branchId, workerBranchId));
const [row] = await db.select().from(table).where(and(...conditions));
if (!row) return res.status(404).json({ error: "Not found" });
```
Returns 404 (not 403) on cross-branch access — avoids leaking that the resource exists.

## Analytics auth (routes/index.ts)

Analytics is mounted with `requireAuth`, NOT `requireOwner`:
```ts
router.use("/analytics", requireAuth, analyticsRouter);
```

**Why:** Workers need access to analytics for their branch dashboard. `requireOwner` was blocking all workers entirely.

**How to apply:** Inside analytics handlers, `getEffectiveBranchId(req)` returns:
- Worker's `req.auth.branchId` (automatic, no override possible)
- Owner's `?branchId` query param (optional filter)
- `null` for owner with no filter (all branches)

## Expenditures table — no branchId column

The `expenditures` table has no `branchId` column — expenses are laundry-wide.
Do NOT try to filter `expenditures` by branch in SQL. Analytics expenditure queries use only `laundryId`.

**Why:** Limitation accepted at design time. Expenditures are tracked at org level, not per branch.

## Files touched in branch isolation audit
- `artifacts/api-server/src/routes/orders.ts` — GET/:id, PATCH/:id, DELETE/:id, payments, pickups, items, receipt, price-adjustments
- `artifacts/api-server/src/routes/pickups.ts` — GET+POST
- `artifacts/api-server/src/routes/customers.ts` — GET/:id, PATCH/:id
- `artifacts/api-server/src/routes/discount-approvals.ts` — GET list scoped to worker's branch orders
- `artifacts/api-server/src/routes/analytics.ts` — getEffectiveBranchId() helper on all 5 endpoints
- `artifacts/api-server/src/routes/index.ts` — analytics mount changed from requireOwner → requireAuth
