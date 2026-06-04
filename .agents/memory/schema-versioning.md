---
name: Schema Versioning & Client Compatibility
description: How APP_VERSION, SCHEMA_VERSION, and version headers flow through CleanTrack to protect offline devices from breaking API changes.
---

## The rule
`lib/version.ts` (frontend) is the single source of truth. Every other file imports from it — nothing hardcodes version strings.

**Why:** `telemetry.ts` previously hardcoded `APP_VERSION = "1.0.0"`. That made the heartbeat and the API header drift independently. Centralizing eliminates drift.

## How to apply

### Bumping for a release
1. Increment `APP_VERSION` in `artifacts/clean-track/src/lib/version.ts`.
2. Increment `SERVER_VERSION` (and `MIN_CLIENT_VERSION` if old clients break) in `artifacts/api-server/src/lib/version.ts`.
3. If `SyncQueueEntry` payload shape changed, increment `SCHEMA_VERSION` too. Dexie needs a new `.version(N).stores({...})` block (copy the previous stores map — no data migration needed for additive changes since `schemaVersion` is optional).

### Wire-level flow
- Every `api.ts` `request()` call sends `X-Client-Version: <APP_VERSION>`.
- Every API response (via `versionMiddleware` in `app.ts`) includes `X-Server-Version` and `X-Min-Client-Version`.
- `checkVersionHeaders()` in `api.ts` flips `_clientOutdated` the first time the server says the client is too old; all `subscribeOutdated()` listeners are notified.
- `OutdatedClientBanner` (rendered in `Layout` above `OfflineBanner`) subscribes on mount and shows an amber bar with a "Reload now" button.

### Operations dashboard
- Operations → Sync Health → Version column compares each device's `d.appVersion` against the imported `CURRENT_APP_VERSION` constant and shows an amber "outdated" badge if they differ.

### IndexedDB migration pattern
- Dexie requires every version to be listed, even if the schema string is identical.
- Additive-only changes (new optional fields on records) need NO `upgrade()` callback — Dexie handles the open.
- Destructive changes (rename/drop indexes) need an `upgrade()` callback on the new version.

## Backward compatibility guarantee
`schemaVersion` is `optional` in `SyncQueueEntry`. Entries written before v2 have no field; the server must treat absence as `schemaVersion = 1`.
