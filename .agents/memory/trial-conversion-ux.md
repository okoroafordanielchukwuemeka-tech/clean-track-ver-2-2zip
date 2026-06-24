---
name: Trial Entitlements & Conversion UX
description: Growth features granted during trial; signup/welcome/pricing pages for first-100-user conversion funnel
---

## Rule
During the 14-day trial, all entitlement and limit checks use `TRIAL_FEATURE_TIER = "pro"` (mapped to Growth limits: 3 branches, 20 workers, analytics, batch processing). After trial expires, the actual `plan` field takes effect.

## Implementation
- `artifacts/api-server/src/lib/entitlements.ts` — `getEffectivePlanFeatures(status, tier)` and `getEffectivePlanLimits(status, tier)` return Growth values when `status === "trial"`
- `artifacts/api-server/src/middleware/subscription.ts` — `requireEntitlement` and `requirePlanLimit` call the effective helpers
- `artifacts/api-server/src/routes/subscription.ts` — `/usage` route uses effective tier so branch warning shows 33% (not 100%) on day 1

## Conversion funnel pages
- `/pricing` — public page (no auth), 3 plan cards, ₦5k/₦10k/₦20k, "Most Popular" badge on Growth
- `/welcome` — post-signup screen, Growth trial benefits panel + 4-step checklist; calls POST /api/auth/welcome-viewed on mount
- Signup page — trial badge ("14-day free trial — no payment required") with 4 feature bullets; redirects to /welcome
- Login page — "View pricing plans" link

## Why
New users on day 1 saw a "1 branch / 100% critical" usage warning despite just signing up. This creates false urgency and friction before the user has even done anything. The trial should feel like Growth, not a crippled free plan.
