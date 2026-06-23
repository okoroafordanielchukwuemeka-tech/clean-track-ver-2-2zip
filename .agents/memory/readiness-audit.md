---
name: First 100 Users Readiness Fixes
description: Friction points identified and fixed during the First 100 Users Readiness Audit
---

## Friction fixes applied

1. **Signup password requirements** — `signup.tsx` shows a 3-pill checklist (8+ chars / Uppercase / Number) dynamically as the user types. The placeholder said "Min. 8 characters" but the backend validates all three; users were failing silently.

2. **Sidebar from 15 to 12+3** — `layout.tsx` splits nav into 12 primary items + a collapsible "Advanced" section (Operations / Communications / Platform Health). State initialises to open if the current path is in the advanced group.

3. **Getting Started Checklist worker step** — `getting-started-checklist.tsx` removes "Add your first worker" from the blocking main checklist (branch → services → customer → order) and puts it in an optional "Unlock more" bonus section at the bottom.

4. **Feedback button** — `feedback-button.tsx` in sidebar footer; opens a dialog with 3 type tabs (bug / feature / general), composes a mailto: link on submit. Accessible to both owners and workers.

5. **Services category dropdown** — `services.tsx` replaces the free-text `<Input>` with a `<Select>` of 9 common laundry categories + an "Other" that reveals a custom text input. The const `SERVICE_CATEGORIES` lists them all.

6. **Demo login rate limit** — Added `POST /auth/demo-login` route to `auth.ts` (skipped by `authLimiter` via `skip: req.path === "/demo-login"`). Added `demoLimiter` (60 req/min) in `rate-limiter.ts` and applied it in `app.ts` BEFORE the auth limiter. Frontend `demo-login.tsx` calls `api.auth.demoLogin()` (new method in `api.ts`).

## Why
- The auth limiter (10 req/15 min) was blocking the demo page — the single most important acquisition surface.
- New users were picking passwords that passed the frontend placeholder ("Min. 8 chars") but were rejected by the backend (needs uppercase + number), causing silent drop-off.
- 15 sidebar items felt like an admin panel on day 1; hiding 3 advanced items behind a toggle cuts cognitive load significantly.
