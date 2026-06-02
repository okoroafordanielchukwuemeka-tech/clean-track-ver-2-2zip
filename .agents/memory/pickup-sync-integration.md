---
name: Pickup Sync Integration
description: Phase 3B.4 — offline pickup sync safety layer, conflict detection, and cache invalidation
---

## Rules

**PickupConflictError** in `queue-service.ts` with three codes:
- `INVALID_ORDER_STATUS` — order not "ready" or "partial_pickup" at sync time
- `QUANTITY_EXCEEDED` — requested qty > server remaining for any item
- `ORDER_NOT_FOUND` — server 404'd on the order

**validatePickupPreSync()** must be called in `syncPickupEntry` before the POST.
Throws `PickupConflictError` → permanent failure, sets `syncStatus="conflict"` on LocalPickup,
queue entry → "failed", syncLog prefixed "CONFLICT:<code>:".

**enqueuePickup** always adds pending payment deps regardless of whether the order is offline-created
or server-synced.  The old guard (`isOfflineOrder` block) caused payments on server-synced orders to
race with their corresponding pickups.

**Pass 5 backoff**: must use `isBackoffExpired(entry)` guard (same as Passes 3 and 4).

**syncEngine.notifyPickupSynced(serverOrderId, localId)** emits `item_synced` with
`operation: "record_pickup"`.  `order-detail` subscribes and invalidates
`["orders", orderId]` + `["orders", orderId, "pickups"]`.

**useConflictLocalPickups(orderLocalId)** polls IndexedDB every 2 s for pickups with
`syncStatus === "conflict"` matching the given `orderLocalId`.

**ConflictSyncBadge** rendered in Pickup History above pending rows (red row background).
Count includes `conflictPickups.length`.

**recoverOrphanedPickups** parseInt guard: skip any item where
`parseInt(i.orderItemLocalId, 10) <= 0` (or NaN) — sending `orderItemId=0` causes a 400.

## Idempotency middleware race fix

The `idempotencyMiddleware` (api-server/src/lib/idempotency.ts) originally fire-and-forgot the
DB cache insert.  A second request arriving before the insert committed would miss the cache and
run the handler twice (duplicate pickups, double payments).

Fix: the `res.json` override now **awaits** the DB insert before flushing the response body to
the client.  The `then(() => originalJson(body))` pattern chains the actual response after the
cache row is committed.

**Why this matters for offline sync**: the queue re-sends the same `clientId` as the idempotency
key on every retry.  If the first attempt succeeds but the insert races, a retry would create a
second pickup/payment row.
