---
name: SLA & Urgency System
description: How countdown timers, urgency levels, and SLA settings work across the Clean Track platform
---

## Architecture

- **SLA settings** stored as 3 integer columns on the `laundries` table: `standardTurnaroundHours` (default 72), `expressTurnaroundHours` (default 24), `premiumTurnaroundHours` (default 48).
- **`processingDueAt`** is a timestamp column on `orders`, computed at order creation time from laundry SLA settings.
- **Frontend fallback**: if `processingDueAt` is null (old orders), `computeDueAt()` in `src/lib/urgency.ts` falls back to `createdAt + DEFAULT_SLA_HOURS[serviceType]`.

## Urgency Levels

| Level | Condition | Color |
|-------|-----------|-------|
| overdue | hoursRemaining ≤ 0 | dark red |
| urgent | hoursRemaining ≤ 5h | red |
| attention | hoursRemaining ≤ 12h | amber |
| safe | hoursRemaining > 12h | green |

## Key Files

- `artifacts/clean-track/src/lib/urgency.ts` — urgency utility (computeDueAt, getUrgency, urgencySortValue)
- `artifacts/clean-track/src/components/countdown-timer.tsx` — ticks every 10s when urgent/overdue, 60s otherwise
- `artifacts/clean-track/src/components/urgency-badge.tsx` — colored badge + dot
- `artifacts/clean-track/src/pages/settings.tsx` — SLA settings page (owner-only)
- `artifacts/api-server/src/routes/settings.ts` — GET/PATCH /settings/sla
- `artifacts/api-server/src/routes/analytics.ts` — GET /analytics/sla endpoint

## Worker Station Priority

Orders sorted by `hoursRemaining` (ascending), grouped into: Overdue → Urgent → Attention → On Track. Each group is a collapsible section with color-coded header.

**Why:** Workers must instantly see what needs action first without manually sorting.

## Future Push Notification Hook

The urgency utility is pure computation — no side effects. A background job can import `computeDueAt` + `getUrgency`, iterate active orders, and emit events for orders crossing urgency thresholds. The existing `emitEvent()` system already handles notifications; connect it to a scheduler (e.g. cron every 15min) to generate due-soon/overdue alerts automatically.
