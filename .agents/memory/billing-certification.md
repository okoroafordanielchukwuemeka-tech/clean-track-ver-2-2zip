---
name: Phase 7.18.0B Billing Certification
description: Key decisions and fixes made during the subscription & billing certification phase.
---

# Phase 7.18.0B Billing Certification

## Correct Plan Values (post-certification)

| Plan       | Price        | Branches | Workers | Orders/mo | Storage | WhatsApp/mo | AI Credits/mo |
|-----------|-------------|---------|--------|----------|---------|------------|--------------|
| Starter   | ₦10,000     | 1        | 3       | 500       | 5 GB    | 500         | 20            |
| Pro       | ₦20,000     | 3        | 6       | 5,000     | 25 GB   | 5,000       | 200           |
| Enterprise| Contact Sales| Unlimited| Unlimited| Unlimited | Unlimited | Unlimited | Unlimited  |

**Why:** Spec document (Phase 7.18.0B) mandated these exact values. Prior code had Pro at ₦30k/unlimited workers/5 branches.

## Architecture Decisions

### DB-Driven Limits (enforced)
- `checkLimit()` in `usage-service.ts` now queries the `plans` table for limits before checking usage counts.
- Falls back to hardcoded `PLAN_LIMITS` in `entitlements.ts` if plan not found in DB.
- `plans` table has: `max_branches`, `max_workers`, `max_orders_per_month`, `max_customers`, `max_storage_mb`, `max_whatsapp_messages_per_month`, `max_ai_credits_per_month`.
- **How to apply:** To change a plan's limits, update the `plans` table row (run `pnpm tsx scripts/seed-plans.ts` to re-seed). No code deploy needed.

### WhatsApp Message Counting
- `computeUsage()` counts `whatsapp_activity_logs` rows with `action = 'MESSAGE_SENT'` for the current month.
- AI credit counting returns 0 (infrastructure ready; no AI feature currently active).

### VALID_TRANSITIONS Fix
- `trial → past_due` was missing from admin VALID_TRANSITIONS (only allowed `active` and `cancelled`).
- Fixed: trial now allows `["active", "past_due", "cancelled"]`.
- **Why:** The subscription lifecycle scheduler legitimately moves trial→past_due when trialEndsAt passes. Admin should be able to replicate this manually.

### seed-plans.ts Field Name Bug (fixed)
- Old bug: seed used `priceMonthlyNgn` (nonexistent field), schema has `monthlyPriceNgn`.
- Fixed and seed now uses `onConflictDoUpdate` (idempotent upsert) instead of `onConflictDoNothing`.

## Remaining Risks
1. **Paystack sandbox not tested** — PAYSTACK_SECRET_KEY not set; full payment flow untested.
2. **WhatsApp message counting is approximate** — counts all MESSAGE_SENT activity log entries; a more precise counter tied to the actual WA API send would be more accurate.
3. **AI credits not tracked** — returns 0 until an AI feature is implemented.
4. **Enterprise pricing** — DB has monthlyPriceNgn=0 for Enterprise (contact sales). The public pricing API still shows ₦50,000 from `pricing.ts` constants. These should be reconciled if Enterprise pricing is ever removed.
