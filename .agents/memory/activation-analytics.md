---
name: Activation Analytics System
description: activation_events table schema, scoring model, event hooks, admin API, and email tracking implementation details
---

## Key Design Decisions

**DB Table**: `activation_events` — unique constraint on `(laundry_id, event_name)` means each milestone fires at most once per workspace. Uses `.onConflictDoNothing()` in Drizzle. This is intentional — funnel needs "first occurrence", not count.

**9 tracked events**: workspace_created, branch_created, service_created, customer_created, order_created, payment_recorded, order_completed, worker_created, first_return_login + 3 email events (welcome_email_sent/opened/clicked)

**Scoring model** (sums to 100):
- workspace_created=10, branch_created=15, service_created=15, customer_created=15, order_created=30, order_completed=15
- States: 0-30=new, 31-70=onboarding, 71-100=activated

**Why**: Idempotent milestone events make funnel math trivial — just COUNT DISTINCT laundry_id per event_name.

## Event Hooks
- signup → workspace_created + branch_created + service_created (all three auto-seeded at signup)
- owner-login (7+ days after createdAt) → first_return_login
- branches POST → branch_created
- services POST → service_created
- customers POST → customer_created
- orders POST → order_created
- orders PATCH (→ completed via pickup route) → order_completed
- orders payments POST → payment_recorded
- workers POST → worker_created

**Important**: `order_completed` fires in the PATCH handler but `ready → completed` transitions are blocked by VALID_STATUS_TRANSITIONS (they go via `POST /orders/:id/pickups`). The tracking call IS there; it fires when the pickup route internally patches to completed.

## Email Engagement Tracking
- `sendWelcomeEmail()` embeds a 1×1 GIF pixel and a redirect link, both using HMAC tokens
- Token = first 32 hex chars of HMAC-SHA256(`email-track:{laundryId}`, JWT_SECRET)
- Tracking endpoint: GET /api/auth/email-track?t=TOKEN&lid=LAUNDRYID&e=EVENT[&url=URL]
- Public route (no auth) — email clients must fetch the pixel without credentials

## Admin API (all behind requireAdmin)
- GET /api/admin/activation/funnel — funnel with drop-off % per step
- GET /api/admin/activation/metrics — activation rate, time-to-first-order (hours), email engagement
- GET /api/admin/activation/health — last 7 days signups with score/state/stuckStage
- GET /api/admin/activation/scores — most recent 100 workspaces with score breakdown

## platform_admins table
- Columns: id, name, email, password_hash (NO role column)
- No auto-seeded admin — must create manually via direct DB insert or future admin-creation endpoint

## Validation Results
- 7/9 events confirmed firing in live tests: workspace_created, branch_created, service_created, customer_created, order_created, payment_recorded, worker_created
- order_completed: code in place, requires order to reach `completed` via pickup flow
- first_return_login: code in place, triggers only after 7+ days from signup
- Email pixel: GET /api/auth/email-track returns 200 image/gif correctly
