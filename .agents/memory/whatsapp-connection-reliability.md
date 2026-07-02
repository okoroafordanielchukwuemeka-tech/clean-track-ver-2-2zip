---
name: WhatsApp Connection Reliability Audit
description: Root causes found and fixed for "Not Connected" shown even when Meta env vars configured; covers status endpoint, debug endpoint, manual form, and logging
---

# WhatsApp Connection Reliability

## Root Causes Found (July 2026 audit)

### Root Cause #1 — CRITICAL: Missing manual connect form
When `META_APP_ID/META_APP_SECRET/META_CONFIG_ID` are not set (the default Replit state), `metaConfig.available = false`, so `useEmbeddedSignup = false`. The frontend previously showed "Not Connected" + "Contact your administrator" with **zero UI path** to manually connect. The `POST /api/whatsapp/connect` backend endpoint existed and worked, but was unreachable from the UI.

**Fix:** Added manual connect form to `WhatsAppBusinessSection` when `!useEmbeddedSignup`. Form fields: WABA ID, Phone Number ID, Access Token (password input), Display Phone Number (optional), Business Name (optional). Both cancel buttons reset all fields including the access token.

### Root Cause #2 — Bug: status="error" treated as connected
`GET /api/whatsapp/status` had `if (!row || row.status === "disconnected")` — so `status="error"` would fall through to the connected branch and attempt stats queries, masking error state.

**Fix:** Changed guard to `if (!row || row.status !== "connected")` — only `"connected"` counts.

### Root Cause #3 — No diagnostic endpoint, no detailed logs
No `/api/whatsapp/debug` endpoint existed. Routes had minimal logging.

**Fix:** Added `GET /api/whatsapp/debug` (requireOwner). Returns:
```json
{ platformConfigured, connectionExists, connected, status, businessName, displayPhoneNumber, connectedAt, providerActive, laundryId }
```
Never exposes tokens, WABA IDs, phone number IDs. Error response omits `detail` to avoid leaking server internals.

Added structured `[whatsapp]` console.log traces to status, callback, connect routes — every step logged.

## Environment State (Replit dev)
- `META_APP_ID/META_APP_SECRET/META_CONFIG_ID` → all `false` (Embedded Signup unavailable)
- Manual connect form is the only connection path until Meta env vars are set
- Demo account: demo@cleantrack.ng / Demo@1234 (laundry_id=1)
- `BACKUP_SECRET` is used to derive the AES-256-GCM key for token encryption

## Verified Working (curl tests)
- `POST /api/whatsapp/connect` → saves encrypted token + provider_configs row → returns `connected: true`
- `GET /api/whatsapp/status` → returns `connected: true` + stats after connect
- `GET /api/whatsapp/debug` → shows full diagnostic without secrets
- `POST /api/whatsapp/disconnect` → sets status="disconnected", deactivates provider config
- All 6 server log trace lines emit correctly

## API client
- `api.whatsapp.debug()` → `GET /whatsapp/debug` → `WaDebugResult`
- `api.whatsapp.connect(data)` → `POST /whatsapp/connect` (already existed, now has UI)
- `WaDebugResult` and `WaConnectInput` types added to api.ts

## Files Changed
- `artifacts/api-server/src/routes/whatsapp.ts`
- `artifacts/clean-track/src/lib/api.ts`
- `artifacts/clean-track/src/pages/settings.tsx`

## How to set up Embedded Signup (production)
Set these three Replit Secrets:
- `META_APP_ID` — Meta App ID
- `META_APP_SECRET` — Meta App Secret
- `META_CONFIG_ID` — Embedded Signup Configuration ID
Once set, server restart shows "WhatsApp Embedded Signup is fully configured." and the one-click button replaces the manual form.
