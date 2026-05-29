---
name: Expenditures & Profitability
description: How the expenditure tracking and profit calculations work in Clean Track
---

**Expenditures table:** `lib/db/src/schema/expenditures.ts`
- `EXPENSE_CATEGORIES` is exported as a const tuple for use in both schema and routes
- Categories: electricity, detergent, water, salaries, transport, maintenance, packaging, miscellaneous
- `requireOwner` middleware guards all write endpoints (POST/PATCH/DELETE)

**Profit formula (used in analytics):**
```
estimatedProfit = collectedRevenue - totalExpenses
```
- Uses `collectedRevenue` (actual cash in), NOT `totalRevenue` (billed amount)
- Dashboard shows a "Low Profit Warning" banner when isProfitable is false and expenses > 0

**Dashboard integration:**
- Row 1 KPIs: Total Revenue, Collected, **Total Expenses**, **Est. Profit**
- Row 2 KPIs: Active Orders, Total Orders, Partial Pickups, Outstanding Balance
- "Expenses by Category" card replaces the old Operational Alerts in second chart row (alerts moved below)
- Profit KPI card uses green/emerald for profit, red for loss, with conditional icon

**Analytics API:**
- `/analytics/full?period=X` includes `overview.totalExpenses`, `overview.estimatedProfit`, and `expenses: { total, byCategory }`
- Expenses are filtered by the same period as the analytics query
