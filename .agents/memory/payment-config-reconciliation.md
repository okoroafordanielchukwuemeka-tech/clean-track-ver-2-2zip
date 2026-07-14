---
name: Payment Config & Manual Reconciliation
description: How manual-payment bank details, duplicate-payment detection, and pricing endpoints are wired across the app — durable decisions from Phase 7.9.
---

## Payment details source of truth
`laundries.businessProfile` (JSONB) gained a `paymentDetails` sub-object
(`preferredMethod`, `bankName`, `accountName`, `accountNumber`, `instructions`).
This is the **only** place bank/payment info lives — receipts, the customer
statement, and WhatsApp `payment_reminder` templates all read it live rather
than duplicating the values. Never hardcode bank details anywhere else.

**Why:** earlier pricing drift (see below) happened specifically because a
frontend page hardcoded values that should have come from one backend source.
Same failure mode was pre-empted here.

**How to apply:** when adding a new payment-instructions surface (report,
export, etc.), pull from `laundry.businessProfile.paymentDetails`, don't add a
new field or copy values in.

## Duplicate-payment detection thresholds
On `POST /orders/:id/payments`: an **exact match** (same amount + method
within 5 minutes) blocks with HTTP 409 unless the client resends with
`confirmDuplicate: true`. A **loose match** (same amount within 30 minutes,
different method) doesn't block — it just downgrades the stored
`confidenceScore` to "medium". No match → "high" confidence.

**Why:** cashiers double-recording the same POS/cash payment was the main
real-world risk; a hard block with an explicit override handles it without
losing legitimate back-to-back payments (e.g. partial + balance same minute).

## Public vs owner-gated pricing
`/api/subscription` is mounted with `requireOwner` at the router level in
`routes/index.ts`, so **no route inside `subscription.ts` can ever be public**
— defining a route without `requireOwner` inside that router still inherits
the owner gate from the mount. The pre-signup marketing pricing page needs an
unauthenticated feed, so its route (`GET /subscription/public-pricing`) is
registered directly on the parent `router` in `routes/index.ts`, *before* the
`router.use("/subscription", requireOwner, subscriptionRouter)` line — same
pattern already used for `/webhooks`.

**How to apply:** any future "make one endpoint under an auth-gated router
prefix public" request needs the route pulled out to the parent router before
the gated mount, not added inside the child router.
