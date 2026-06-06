---
name: WhatsApp Provider Integration
description: Meta WhatsApp Cloud API provider layer — architecture, security, and routing decisions
---

## Architecture

Provider abstraction: `ChannelProvider` interface with `send()`, `handleWebhook()`, `validateConfiguration()`.

**Files:**
- `lib/db/src/schema/provider-configs.ts` — `provider_configs` table, 25th table in schema
- `artifacts/api-server/src/lib/providers/channel-provider.ts` — base interface + ProviderError
- `artifacts/api-server/src/lib/providers/whatsapp-cloud.ts` — WhatsAppCloudProvider class
- `artifacts/api-server/src/lib/providers/registry.ts` — providerRegistry singleton (5min TTL cache)
- `artifacts/api-server/src/routes/webhooks.ts` — public webhook routes

## Key Decisions

**Phone normalisation:** `normalizePhoneE164()` in whatsapp-cloud.ts handles 08xx (Nigerian local), +234, 234, and international formats.

**Webhook routing (multi-tenant):** Single `/api/webhooks/whatsapp` endpoint; webhook payload contains `phone_number_id` in metadata which could be used to route to correct tenant. GET challenge verifies against each tenant's `webhookVerifyToken` stored in provider_configs.

**Token masking:** GET /communication/providers/whatsapp returns `accessTokenMasked` (last 4 chars, rest are bullets). Frontend detects `tokenTouched` state to decide whether to send the masked value or a real update. Backend checks if token is all bullets and skips update if so.

**Webhooks must be PUBLIC:** Registered at `router.use("/webhooks", webhooksRouter)` BEFORE `requireAuth` middleware in routes/index.ts. Meta's servers don't send Bearer tokens.

**Delivery lifecycle ordering:** Webhook handler enforces rank order (queued=0, sent=1, delivered=2, read=3, failed=4). Won't downgrade status (e.g. stale "sent" after "delivered" is dropped).

**Registry invalidation:** Call `providerRegistry.invalidate(laundryId, "whatsapp")` after PUT/DELETE on provider config to force fresh DB lookup.

**Why:**
- Meta Cloud API v21.0 (not v17/v18 — newer versions are more stable)
- Node 20 native `fetch` — no node-fetch package needed
- Per-tenant configs in DB, not env vars, because this is multi-tenant SaaS
- Immediate 200 on webhook POST — Meta requeues if no fast response

## API Endpoints

```
GET    /api/communication/providers/whatsapp           — get config (masked)
PUT    /api/communication/providers/whatsapp           — save/update config
POST   /api/communication/providers/whatsapp/validate  — validate via Meta API
DELETE /api/communication/providers/whatsapp           — remove config
POST   /api/communication/test-message                 — send test message (logs result)
POST   /api/communication/messages/:id/retry           — retry failed/queued message
GET    /api/webhooks/whatsapp                          — Meta challenge (PUBLIC)
POST   /api/webhooks/whatsapp                          — delivery status updates (PUBLIC)
```

## WhatsApp Send API

```
POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
Authorization: Bearer {access_token}
{ "messaging_product": "whatsapp", "recipient_type": "individual",
  "to": "{e164_phone}", "type": "text", "text": { "preview_url": false, "body": "..." } }
Response: { "messages": [{ "id": "wamid.xxx" }] }
```

## Validation API

```
GET https://graph.facebook.com/v21.0/{phone_number_id}?fields=display_phone_number,verified_name,quality_rating
→ { display_phone_number, verified_name, quality_rating }
```
