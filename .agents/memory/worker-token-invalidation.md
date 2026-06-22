---
name: Worker Token Invalidation after PIN Change
description: How worker session invalidation on PIN reset works — why DB lookup is required, not pure-JWT comparison
---

## Rule
Worker tokens are invalidated after a PIN reset via a **DB lookup in middleware**, not a pure-JWT field comparison.

**Why:** Embedding `pinChangedAt` in the JWT and comparing it against `iat` is circular — `iat` is always ≥ `pinChangedAt` because login happens after the PIN was set. The check `iat < payload.pinChangedAt` never fires. The correct implementation fetches `workers.pinChangedAt` from the DB (primary-key SELECT) and compares against `iat` from the JWT.

**How to apply:**
- `requireAuth` in `middleware/auth.ts` is async; for `payload.type === "worker"`, it does `SELECT pinChangedAt FROM workers WHERE id = workerId`.
- If `iat * 1000 < row.pinChangedAt.getTime()` → return 401 `{ code: "PIN_CHANGED" }`.
- Workers with `pinChangedAt = null` in DB (pre-migration) are allowed through — backward compat.
- The JWT still embeds `pinChangedAt` (informational), but it is not the authoritative source for the check.
- `authLimiter` in `rate-limiter.ts` has `skip: (req) => req.path === "/me"` so `/api/auth/me` doesn't burn the 10 req/15min brute-force budget.

## Key timestamps
- `pinChangedAt` stored as `new Date(Math.floor(Date.now() / 1000) * 1000)` — truncated to second boundary to match JWT `iat` second precision.
- Set on worker creation (POST /workers) and on PIN reset (PATCH /workers/:id with `pin` field).
- Clearing lockout fields (`failedPinAttempts`, `pinLockedUntil`) also happens in the same PATCH handler when `pin` is provided.
