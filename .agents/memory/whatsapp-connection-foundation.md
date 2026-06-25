---
name: WhatsApp Connection Foundation
description: Phase 1 WhatsApp Business connection architecture — whatsapp_connections table, 3 endpoints, AES-256-GCM token encryption, dual-write to provider_configs
---

## Architecture

**Two-table design:**
- `whatsapp_connections` — user-facing connection record; canonical source of truth for Embedded Signup flow. Has connectedAt/disconnectedAt/status. Access token AES-256-GCM encrypted.
- `provider_configs` (existing) — message-sending pipeline reads from this. On connect, both tables are written atomically in a transaction.

**Why:** The existing provider_configs powers the live message queue. The new whatsapp_connections is designed for the Embedded Signup UX (owner never sees raw tokens). Dual-write keeps them in sync without touching the message pipeline.

## Token Encryption

Key: `crypto.createHash("sha256").update(BACKUP_SECRET).digest()` — 32 bytes, derived from the already-required BACKUP_SECRET.  
Format stored: `"<iv_hex>:<authTag_hex>:<ciphertext_hex>"` (AES-256-GCM).  
The decryptToken() function is in the route for future use (e.g. Phase 2 token refresh).

## Endpoints

All three are `requireOwner` — workers cannot access. All scoped by `req.auth.laundryId`.

- `GET /api/whatsapp/status` — returns `{ connected: false }` or full status (never returns token)
- `POST /api/whatsapp/connect` — validates body, encrypts token, upserts both tables
- `POST /api/whatsapp/disconnect` — sets status=disconnected, deactivates provider_configs

## Frontend

Settings → WhatsApp Business section added to `artifacts/clean-track/src/pages/settings.tsx`.  
Types `WaConnectionStatus` and `WaConnectInput` exported from `artifacts/clean-track/src/lib/api.ts`.  
API methods at `api.whatsapp.{status, connect, disconnect}`.

## Phase 2 Embedded Signup Integration

The connect dialog currently takes manual credentials. Phase 2 will replace the dialog body with the Meta JS SDK `FB.login()` call from a `<script>` tag, which returns `{ code }` → exchange for token server-side via `/oauth/access_token`. The `POST /api/whatsapp/connect` endpoint stays identical — only the client-side credential source changes.

## Tenant Isolation

Verified: Laundry A's whatsapp connection is never visible to Laundry B. Each owner only sees their own `laundryId`-scoped row. No cross-laundry data leakage possible at the DB query level.
