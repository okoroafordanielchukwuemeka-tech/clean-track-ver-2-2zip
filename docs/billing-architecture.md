# Phase 7.8 — Payment Automation & Billing Infrastructure

**Status:** Complete. Built on top of Phase 7.7 (subscription/trial/plan-limit system) without modifying `PLAN_FEATURES`, `PLAN_LIMITS`, or pricing amounts. This phase automates the *billing* around the existing plans — it does not change what the plans are worth or what they unlock.

## 1. Provider choice — Paystack over Flutterwave

Paystack was chosen because:
- Its recurring-charge primitive (`charge_authorization` against a saved card `authorization_code`) gives CleanTrack full control over renewal timing, retries, and grace periods, instead of relying on the provider's own subscription/plan objects and webhook cadence.
- It's the dominant processor for Nigerian SaaS billing (CleanTrack's market), with mature NGN support and a signed-webhook model (`x-paystack-signature`, HMAC-SHA512) that's straightforward to verify.
- `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` were already present as Replit secrets, confirming Paystack was the intended integration.

Flutterwave was not pursued further once these were confirmed.

## 2. Recurring billing architecture

Rather than using Paystack's native Plan/Subscription objects, CleanTrack:
1. Runs every checkout as a normal one-off transaction (`/transaction/initialize`) with `channels: ["card"]` so Paystack captures and returns a reusable `authorization_code` on success.
2. Stores that authorization (`payment_subscriptions` table) against the laundry.
3. On each renewal date, an hourly scheduler (`billing-renewal.ts`) finds due rows and calls `/transaction/charge_authorization` directly — no customer interaction required.
4. Success/failure of that charge feeds the same `activatePlanFromPayment` / `recordFailedPayment` paths used for manual checkouts, so dunning, grace periods, and status transitions are identical regardless of trigger.

This keeps retry/backoff/grace logic entirely inside CleanTrack's codebase instead of split across two systems.

## 3. Data model (3 new tables)

| Table | Purpose |
|---|---|
| `webhook_events` | Idempotency ledger for inbound Paystack webhooks. Unique `(provider, eventKey)`; a duplicate delivery is detected and ignored before any side effect runs. |
| `invoices` | Permanent, append-only invoice record (one per checkout/renewal attempt). Drives the owner-facing invoice list and the admin billing dashboard. Never deleted, even on failure — failed invoices stay visible with a "Retry payment" action. |
| `payment_subscriptions` | One row per laundry holding the saved card authorization, next charge date, and consecutive-failure count used for dunning. |

No changes to `entitlements.ts` (features/limits) or `pricing.ts` (amounts).

## 4. Payment flows

All four flows funnel through `billing-service.ts`, which classifies the request (`purpose`: `new_subscription` / `upgrade` / `downgrade` / `reactivation`) by comparing the current plan rank to the target plan rank, then:
1. Creates a `pending` invoice.
2. Calls Paystack `initializeTransaction` with a `callbackUrl` of `/billing/callback?reference=...`.
3. Returns the hosted `authorizationUrl` to the frontend, which redirects the browser.

Downgrades and upgrades use the same checkout path (no proration logic was requested or added — the new plan/period is billed at its full listed price starting from the successful payment).

**Pay-invoice / retry:** `POST /subscription/retry-payment` re-runs checkout against an existing failed/pending invoice.

**Reactivation:** `POST /subscription/reactivate` is the same checkout flow, gated to laundries with `subscriptionStatus = "cancelled"`.

## 5. Webhook processing & idempotency

`POST /webhooks/paystack`:
1. Verifies `x-paystack-signature` (HMAC-SHA512 of the raw body with `PAYSTACK_SECRET_KEY`) — **fails closed**: missing/invalid signature is rejected with 403 before any parsing.
2. Inserts an `event key` (`event:reference:status`) into `webhook_events`; a unique-constraint violation means "already processed" and the handler returns `200 OK` without side effects (safe for Paystack's automatic retries).
3. For `charge.success`, re-verifies the transaction server-side via `verifyTransaction` (never trusts the webhook payload's own "success" claim) before activating the plan.
4. For `charge.failed`, calls `recordFailedPayment`, which moves `active` subscriptions into a 7-day `past_due` grace period and sends a payment-failed email.
5. Any other event type is logged and ignored (forward-compatible).

Verified live: identical payload replayed after signature-check passed is logged as `duplicate event ignored` and produces no duplicate invoice/state change; a tampered signature is rejected with `403` before the body is even parsed.

## 6. Invoices

Invoices render as standalone print-friendly HTML (`GET /subscription/invoices/:id/html`, and `GET /admin/billing/invoices` for platform admins) — no PDF library added; owners use the browser's native print-to-PDF. Every checkout and renewal attempt (success or failure) produces a permanent invoice row, so the list is a complete audit trail, not just a receipt of successful charges.

## 7. Subscription lifecycle automation

- Failed renewal → `past_due` (7-day grace, unchanged suspension timing from Phase 7.7) → existing daily `subscription-lifecycle.ts` scheduler still handles suspension after grace expiry; this phase only adds the renewal *charge* step in front of it.
- Successful payment (checkout, retry, or renewal) → `activatePlanFromPayment`, which is idempotent on invoice status, so the same webhook or a manual "Verify Payment" click landing twice cannot double-activate or double-count revenue.
- No changes were made to the trial scheduler; the renewal-billing scheduler (`billing-renewal.ts`) is purely additive and starts alongside it.

## 8. Owner-facing UI (`Settings → Billing`)

- Plan cards now open a real checkout modal (`CheckoutModal`) with a monthly/annual toggle and a "Pay with card" button that redirects to Paystack's hosted checkout — falls back to the original WhatsApp/email contact flow automatically if Paystack isn't configured in an environment.
- New card-on-file strip showing masked card, bank, and next charge date, plus a warning badge if consecutive charge failures are accumulating.
- New invoice list replacing the old "invoices aren't available yet" placeholder — status badges, print/view links, and a one-click "Retry payment" for failed invoices.
- New `/billing/callback` route: polls `verify-payment` after the Paystack redirect and shows a success/failure screen before returning to Settings.

## 9. Admin-facing UI (`Admin Command Center → Billing`)

New tab, `requireAdmin`-gated, with:
- MRR / ARR, 30-day revenue, 30-day churn rate, 30-day failed-payment count.
- Subscription-status and plan-mix breakdowns.
- At-risk tenant list (anyone currently in the `past_due` grace window, with consecutive-failure counts).
- Filterable, paginated invoice list across all tenants.

## 10. Security summary

- Webhook signature verification is fail-closed (reject on missing/invalid signature, verified live with a 403 test).
- Server-side re-verification of every `charge.success` against Paystack directly — the webhook payload's own status field is never trusted for activation.
- All mutating billing routes require an authenticated owner (`requireAuth` + laundry scoping); admin billing routes require `requireAdmin`.
- No card data ever touches CleanTrack's servers — Paystack's hosted checkout collects it; CleanTrack only stores the authorization code and last-4/bank/type metadata Paystack returns.
- Secrets (`PAYSTACK_PUBLIC_KEY`, `PAYSTACK_SECRET_KEY`) are read from Replit Secrets, never logged or exposed to the frontend beyond the public key.

## 11. Testing performed

Executed directly against the running dev server with real Paystack test-mode keys (no mocks):

| Test | Result |
|---|---|
| `GET /subscription/payment-config` | Returns `paystackConfigured: true` + public key |
| `POST /subscription/checkout` (new subscription, Starter/monthly) | Returned live Paystack `authorizationUrl` + created `pending` invoice |
| `GET /subscription/invoices` | Returned the created invoice with correct amount/status |
| `POST /subscription/verify-payment` on an unpaid reference | Correctly returned `abandoned` and transitioned the invoice to `failed` + logged a `payment_failed` subscription-log entry (no incorrect status change since the trial account was never `active`) |
| `POST /subscription/retry-payment` on the failed invoice | Returned a fresh Paystack `authorizationUrl` against the same invoice |
| `POST /webhooks/paystack` with a correctly-signed synthetic `charge.success` payload | Accepted (`200 ok`), processed once |
| Same payload replayed | Detected via `webhook_events` unique constraint, logged as duplicate, no double processing |
| Same payload with a tampered signature | Rejected with `403` before processing |
| `GET /admin/billing/overview`, `/invoices`, `/at-risk` | All return correctly shaped, correctly filtered data as a platform admin |
| Frontend: Billing settings tab, `/billing/callback`, admin Billing tab | Rendered without console errors; `tsc --noEmit` shows no new type errors introduced by this phase (pre-existing unrelated errors in `layout.tsx`, `receipt-view.tsx`, `customers.tsx` and pre-existing `@workspace/db` path-alias noise in `tsc -p .` — same pattern across all pre-existing route files, not a regression) |

Test tenant and test invoices created during this verification were deleted afterward; no synthetic data was left in the database.

## 12. What was intentionally left unchanged

- `entitlements.ts` (`PLAN_FEATURES`, `PLAN_LIMITS`) — untouched.
- `pricing.ts` (plan amounts) — untouched.
- Existing trial/grace scheduler (`subscription-lifecycle.ts`) — untouched; renewal billing runs as a separate, additive scheduler.
- Dashboard trial/past-due/suspended banners — left as informational banners per the "don't redesign existing workflows" constraint; the real purchase action lives in Settings → Billing as before, now backed by live payments instead of manual contact.
