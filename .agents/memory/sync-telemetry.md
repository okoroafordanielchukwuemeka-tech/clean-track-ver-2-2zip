---
name: Sync Telemetry & Fleet Visibility
description: How device heartbeats are collected, stored, and surfaced in the Operations Center Sync Health tab.
---

## Architecture

- **DB table**: `device_heartbeats` — one row per `(laundry_id, device_id)` pair, upserted on each heartbeat.
- **Backend**: `POST /api/telemetry/heartbeat` (requireAuth — workers + owners both send); `GET /api/operations/sync-health` (requireOwner, returns fleet view with staleness classification).
- **Frontend sender**: `artifacts/clean-track/src/lib/telemetry.ts` — `initTelemetry()` called once in `main.tsx` via `runRecovery().finally(...)`. Fires every 30s + on online/offline events. All errors swallowed — telemetry never affects the app.
- **Frontend tab**: `SyncHealthTab` component in `operations.tsx`, under the "Sync Health" TabsTrigger. Auto-refetches every 30s.

## Staleness bands (server-computed)
- `fresh` — last heartbeat < 5 minutes ago
- `stale` — 5–60 minutes
- `very_stale` — > 60 minutes

## Row highlight rules (UI)
- Red bg: `failedCount > 0` OR `conflictCount > 0`
- Amber bg: `pendingCount > 0` AND `staleness !== "fresh"` (stuck queue)
- Opacity-55: `very_stale`
- Hover-only: healthy / fresh

## Key constraints
- `telemetry.ts` reads sync engine and localDb read-only — zero writes to sync/queue/recovery code.
- Device UUID stored in `localStorage` key `ct_device_id`; created once per browser profile.
- `recoveryCount` is always 0 (no write hook in recovery.ts) — documented known limitation.
- `branchName` is resolved at query time via LEFT JOIN on branches — not stored in heartbeat row.

**Why:** The telemetry layer was designed to be non-invasive. Any edit to sync-engine.ts, queue-service.ts, or recovery.ts to emit telemetry would need to go through the existing conflict/error handling pipeline first.

**How to apply:** When extending telemetry (e.g., adding a new metric), add the field to `device_heartbeats` schema, `HeartbeatInput` type in api.ts, `telemetry.ts` sender, and the upsert set in `telemetry.ts` backend route. Never put side-effects in telemetry.ts that could throw or block the sync loop.
