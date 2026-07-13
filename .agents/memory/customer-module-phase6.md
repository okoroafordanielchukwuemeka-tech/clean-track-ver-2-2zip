---
name: Customer Module Phase 6
description: Phase 6 production upgrade — tags column, sorting, inactive filter, profile redesign, payment history tab
---

## Schema change
- Added `tags text` column to customers table (stores JSON array string e.g. `'["VIP","Business"]'`)
- Pushed via `pnpm --filter @workspace/db push-force`

## Key type design
- `Customer.tags` was removed from the TS interface (raw DB field conflicts with `CustomerMetrics.tags: string[]`)
- `CustomerMetrics.customTags: string[]` = owner-set custom tags (parsed from DB)
- `CustomerMetrics.tags: string[]` = auto-computed tags (vip, repeat, has_balance, has_pickups)
- `CustomerMetrics.cancelledOrders: number` added to computeMetrics()

**Why:** `CustomerWithMetrics extends Customer, CustomerMetrics` — both interfaces must not share property names with incompatible types.

## Backend (customers.ts route)
- GET / supports: `sort` (newest/oldest/most_orders/highest_spending/outstanding_balance/last_visit), `tag=inactive`, `tag=archived`→`archived=true`, search by numeric customer ID
- PATCH serializes `tags` array to JSON string before storing; returns `customTags` in response
- computeMetrics returns `cancelledOrders` field

## Frontend (customers.tsx)
- Client-side sort + filter with useMemo (instant, no API round-trip per filter change)
- Debounced search (300ms) sent to backend
- Filter tabs: All | Balance | Pickups | VIP | Repeat | Inactive | Archived
- Sort dropdown: 6 options
- Profile modal: branch name (from useBranch().branches), cancelledOrders, lifetime revenue, quick actions bar
- Inline notes editor (click notes box to edit, or "+ Add private notes" if none)
- Custom tags editor (preset chips + custom input)
- Payment History tab uses receipts endpoint (ReceiptListResponse.receipts); remainingBalance is a string — use Number()
- Order history now shows ALL orders (no .slice(10) cap) with pickup/payment status columns
- Archive replaces Delete in UI; restore button for archived customers
