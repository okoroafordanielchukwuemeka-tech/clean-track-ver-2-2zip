---
name: Payment & Billing Automation (Paystack)
description: Recurring billing architecture, webhook idempotency, and dunning design for Phase 7.8
---

Recurring charges use Paystack `charge_authorization` against a saved card authorization (captured from the first checkout transaction), triggered by CleanTrack's own hourly scheduler — not Paystack's native Plan/Subscription objects.
**Why:** keeps retry/backoff/grace-period logic fully inside the app instead of split across two systems with different webhook cadences.
**How to apply:** any new recurring-charge feature should reuse `payment_subscriptions` (saved authorization + next charge date) and `billing-service.ts`'s `chargeRenewal`, not introduce a second billing pathway.

Webhook idempotency: a `webhook_events` table with a unique `(provider, eventKey)` constraint is checked before any side effect; a duplicate insert (constraint violation) means "already processed, no-op". Every `charge.success` webhook is re-verified server-side via Paystack's verify-transaction endpoint before activating anything — the webhook payload's own status is never trusted directly.
**Why:** Paystack retries webhook delivery on any non-2xx or timeout, and payloads can in theory be spoofed even with signature checks disabled by misconfiguration — defense in depth.
**How to apply:** any new webhook-driven provider integration should follow the same two-layer pattern (dedup table + re-verify-before-activate).

Transactional payment emails (per-transaction success/failure) must bypass the existing `lifecycleEmailLog` dedup table, since that table is unique per laundry+type and is meant for one-time trial/renewal-reminder emails, not repeatable per-charge emails. Use `sendTransactionalMail` (email-service.ts) instead, relying on invoice/webhook-event state for idempotency.
