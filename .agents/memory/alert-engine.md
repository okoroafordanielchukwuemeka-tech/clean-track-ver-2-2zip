---
name: Alert Engine & Incident Management
description: Architecture and key rules for the alerting system built on top of CleanTrack monitoring
---

# Alert Engine

## Schema
- Table: `alerts` (23rd table) in `lib/db/src/schema/alerts.ts`
- Key fields: `laundryId`, `branchId`, `deviceId`, `severity` (info/warning/critical), `category` (9 values), `status` (open/acknowledged/resolved), `fingerprint` (dedup key), `acknowledgedBy/At`, `resolvedBy/At`, `metadata` (JSONB)
- Indexes on: laundryId, status, severity, category, createdAt, fingerprint

## Alert Engine (`artifacts/api-server/src/lib/alert-engine.ts`)
- `ensureAlert()` — inserts only if no open/acknowledged alert with same fingerprint exists per laundry
- `autoResolve()` — updates status=resolved + resolvedBy="system" when condition clears
- `runAlertChecksForLaundry(laundryId)` — evaluates all rules for one tenant
- `runAlertChecks()` — iterates all active laundries, calls above

## Scheduler
- In `artifacts/api-server/src/index.ts`: runs once on startup, then every 5 minutes via `setInterval(...).unref()`

## Alert Rules (11 implemented)
1. `sync:heartbeat_missing:{deviceId}` — info, 5–30 min no heartbeat
2. `sync:device_offline_30m:{deviceId}` — warning, 30min–24h offline
3. `sync:device_offline_24h:{deviceId}` — critical, >24h offline
4. `sync:queue_high:{deviceId}` — warning, pending 500–1000
5. `sync:queue_critical:{deviceId}` — critical, pending >1000
6. `sync:failed_count:{deviceId}` — warning, failed >5
7. `sync:conflict_count:{deviceId}` — warning (category: payment), conflicts >2
8. `sync:queue_total_high:{laundryId}` — warning, total pending >2000
9. `version:app_version_mismatch:{laundryId}` — info, multiple versions
10. `backup:missing:{laundryId}` — critical, no backup or >24h old
11. `system:schema_checkpoint_overdue:{laundryId}` — warning, no snapshot in 7 days

## API Routes (`artifacts/api-server/src/routes/alerts.ts`)
All under `requireOwner`:
- `GET /api/alerts` — list with filters: status, severity, category, branchId, from, to, limit, offset
- `GET /api/alerts/counts` — `{critical, warning, info, unresolved, open, acknowledged, resolved}`
- `POST /api/alerts/run-check` — manually trigger evaluation for current laundry
- `POST /api/alerts/:id/acknowledge` — only on open alerts; sets acknowledgedBy from JWT name/email
- `POST /api/alerts/:id/resolve` — on open or acknowledged; sets resolvedBy from JWT

## Frontend
- `AlertRecord`, `AlertsListResponse`, `AlertCounts` types exported from `api.ts`
- `api.alerts.{list, counts, acknowledge, resolve, runCheck}` in api object
- `AlertCenterTab` component in `operations.tsx` (before `OperationsPage`)
- Added to Operations Center as "Alert Center" tab (9th tab)
- Summary cards: Critical/Warning/Info/Unresolved
- Status tabs with live counts badges; Severity + Category filters
- Auto-refreshes every 60s; "Run Check" button for manual trigger

**Why:** Fingerprint-based dedup prevents alert storms; auto-resolve ensures owners see only current issues; system-level resolvedBy distinguishes auto vs manual resolution.
