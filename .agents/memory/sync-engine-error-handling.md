---
name: Sync Engine Error Handling
description: How the Phase 3B.1 sync engine classifies errors, applies backoff, and patches local records after sync.
---

## Rule
- `HttpError` class in `artifacts/clean-track/src/lib/api.ts` carries `status: number`. The `request()` function throws it for ALL non-2xx responses (including 401).
- In `queue-service.ts`, `isClientError(err)` returns `true` for 4xx excl. 408/429 → these are permanently failed immediately (attempts set to MAX_ATTEMPTS without incrementing from current value).
- `computeBackoffMs(attempts)` = `min(2^attempts * 1000, 60000)` ms. `isBackoffExpired(entry)` checks elapsed time ≥ backoff window. Backoff checks run in processQueue Pass 1 and Pass 2 before attempting each entry.
- After `syncOrder` succeeds, both `serverId` (number) AND `orderId` (server-generated date-based string like "20260602001") are patched onto the local order record.

**Why:**
- Without `HttpError`, catch blocks could not distinguish 4xx validation failures from network errors, causing wasted retries on data that will never be valid.
- Without backoff, processQueue() (30s poll) would hammer the server on every tick after a failure.
- `orderId` string is the canonical human-readable reference displayed in the UI; without patching it, synced offline orders would show a null reference number.

**How to apply:**
- Any new sync operation (future phases: payments, pickups) should follow the same pattern: import `HttpError`, call `isClientError()` in catch, set `lastAttemptAt` on every failure, and apply backoff in processQueue.
- 408 (Request Timeout) and 429 (Too Many Requests) must remain retryable — they are transient.
- The test script at `scripts/test-sync-engine.mjs` covers all these cases and must pass on any change to the sync engine.
