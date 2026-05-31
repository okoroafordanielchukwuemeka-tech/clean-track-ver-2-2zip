---
name: Branch Filtering Pattern
description: How owner-side branch filtering works across frontend pages and backend routes
---

## The Pattern

**Frontend rule**: Every page that lists orders, customers, or analytics MUST:
1. Call `const { activeBranchId, activeBranch } = useBranch()` 
2. Include `activeBranchId` in the `queryKey` array so React Query refetches when branch switches
3. Pass `activeBranchId` to the API function

**API client rule**: Functions that support branch filtering accept `branchId?: number | null`. The client strips `null` values before building the query string.

**Backend rule**: All list routes already use `getEffectiveBranchId()` or the pattern:
```ts
const effectiveBranchId = req.auth!.branchId ?? (branchParam ? parseInt(branchParam as string) : null);
if (effectiveBranchId) conditions.push(eq(orders.branchId, effectiveBranchId));
```
Workers are auto-scoped to their branch; owners can filter via `?branchId=N`.

## Pages Fixed
- `orders.tsx` — queryKey: `["orders", activeBranchId]`
- `customers.tsx` — queryKey: `["customers", search, tag, activeBranchId]`
- `batches.tsx` — queryKey: `["orders", "pending", activeBranchId]`
- `dashboard.tsx` — all 4 analytics queries include `activeBranchId`; subtitle shows branch name

## /orders/recent Was Missing
The `/orders/recent` backend route did NOT exist — requests fell through to `/:id`, tried to parse "recent" as integer, silently returned error. The dashboard was gracefully handling `undefined` via `(recent ?? [])`. Added the route before `/:id` at orders.ts.

**Why:** Named routes (e.g. `/recent`, `/summary`) must be registered BEFORE the `/:id` param catch-all in Express, or they are swallowed.
