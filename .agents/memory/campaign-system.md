---
name: Campaign System
description: WhatsApp bulk campaign system — schema, API, and key implementation details
---

## Tables
- `campaigns` — main campaign record (status machine: draft→scheduled/queued→sending→sent/failed/cancelled)
- `campaign_recipients` — one row per customer per campaign send; statuses: queued/sending/delivered/failed/cancelled

## Entitlement gate
- `HAS_WHATSAPP_CAMPAIGNS` = false for free/starter, true for pro/business/trial
- GET /campaigns: allowed for all owners (read for upgrade gate UI)
- POST /campaigns, POST /campaigns/:id/send, POST /campaigns/preview-audience: require `requireEntitlement("HAS_WHATSAPP_CAMPAIGNS")`
- All routes behind `requireOwner` in index.ts

## Batch send processor
`processCampaignSend()` runs in setImmediate (background, non-blocking).
- Fast path: if no WhatsApp provider → single bulk UPDATE of all recipients to "failed" (handles 10k rows in ~1s)
- Provider path: parallel batches of CONCURRENT_SENDS=50, then bulk UPDATE results in BATCH_SIZE=500 chunks

**Why:** Sequential per-recipient DB round-trips take 30+ seconds for 10k records. Bulk UPDATE reduces to O(1) queries for no-provider path and O(n/500) for provider path.

## Audience types (11 total)
all, vip (tags JSON LIKE), repeat (2+ orders), inactive_30/60/90 (lastActivityAt), outstanding_balance, ready_pickup, completed_orders, custom_tag, custom_selection

## Frontend
- `artifacts/clean-track/src/components/communications/campaigns-tab.tsx` — self-contained component
- Imported in `artifacts/clean-track/src/pages/customer-hub.tsx` replacing old placeholder
- Subscription gate: reads `/subscription/status`, shows `UpgradeGate` if `!HAS_WHATSAPP_CAMPAIGNS`
- Polls every 10s for status updates; campaign detail view polls every 3s when campaign is active

## API types
All types in `artifacts/clean-track/src/lib/api.ts` under the `campaigns` namespace.
