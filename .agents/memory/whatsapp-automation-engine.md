---
name: WhatsApp Automation Engine
description: Rule-based automation system that fires WhatsApp messages when order/payment events occur
---

# WhatsApp Automation Engine

## Architecture

Rule-based (no AI). Each laundry gets 5 default rules stored in `automation_rules` table.

**Trigger events:** ORDER_CREATED, PAYMENT_RECEIVED, ORDER_READY, ORDER_COMPLETED, ORDER_DELIVERED

## Key files

- `lib/db/src/schema/automation-rules.ts` — schema + `AUTOMATION_TRIGGER_EVENTS` const
- `artifacts/api-server/src/lib/automation-service.ts` — `fireAutomation()`, `initializeDefaultRules()`
- `artifacts/api-server/src/routes/automation-rules.ts` — CRUD: GET /, PATCH /:id, POST /initialize
- `artifacts/api-server/src/routes/index.ts` — mounted at `/automation-rules` with `requireAuth`

## Event wiring

- ORDER_CREATED, ORDER_READY, ORDER_COMPLETED, PAYMENT_RECEIVED — wired in `orders.ts`
- ORDER_DELIVERED — wired in `pickups.ts` when `meta.allPickedUp === true`; fetches customer phone from customers table after transaction using `customerId`

**Why:** ORDER_DELIVERED fires on all-items-picked-up regardless of payment status (delivery semantics, not payment semantics).

## Signup flow

`initializeDefaultRules(laundry.id)` is called in `auth.ts` signup handler after `seedLaundryDefaults()` — fire-and-forget.

## Security

- Read: `requireAuth` + `checkPermission("view:whatsapp")`
- Write: `checkPermission("manage:whatsapp")` (owners bypass)
- Initialize: `requireOwner` only

## Frontend

Two UI surfaces:
1. **Settings → WhatsApp Automations** (`settings.tsx`, `WhatsAppAutomationsSection`) — owner-facing settings page
2. **Communications → Automations tab** (`automations-tab.tsx`, `AutomationsTab`) — more polished card-based UI

Both use query key `["automation-rules"]` and `api.automationRules.*`.

## API client

`api.automationRules.list()`, `.update(id, data)`, `.initialize()` in `artifacts/clean-track/src/lib/api.ts`

## Template variables

`{{customerName}}`, `{{orderId}}`, `{{businessName}}`

## pickups.ts customer phone fix

The lock query SELECT must include `customer_id` (not just `customer_name`). After transaction, query `customers` table by `customerId` to get phone for ORDER_DELIVERED automation. `meta.customerPhone` was never in the original meta object — must be fetched separately.
