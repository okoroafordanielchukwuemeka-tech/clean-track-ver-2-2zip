---
name: Offline Status Updates
description: Phase 3B.2 — how offline order status/field updates are queued, synced, and recovered
---

## Rule
`update_order_status` is the SyncOperation for any offline PATCH to an order (status, assignedWorkerId, isVerified, etc.).

## localId convention
- **Server-synced orders** (fetched via React Query, may not have a localDb record): use synthetic `"srv-<serverId>"` as the localId. The queue entry payload stores `serverId` directly.
- **Locally-created orders** (syncStatus = "pending_create", serverId = null): use the real `localId`. Queue entry gets `dependsOn: [localId]` so it waits for `create_order` to finish.

## syncStatus values added
`LocalOrder.syncStatus` extended to include `"pending_status_update"` — set when a server-synced local record has a queued status change. Reset to `"synced"` when the last pending `update_order_status` entry for that localId is processed.

## processQueue pass order
1. Pass 1: `create_customer`
2. Pass 2: `create_order` (dependsOn customers)
3. Pass 3: `update_order_status` (dependsOn create_order for offline-created orders)

## syncOrderStatusEntry
Takes the full SyncQueueEntry (not just localId) — needed because multiple update_order_status entries can exist for the same localId (user changed status several times while offline). Each is processed in position order.

## UI offline interception pattern (worker.tsx / order-detail.tsx)
```ts
if (getIsOnline()) {
  updateMutation.mutate(changes);      // normal server call + RQ invalidation
} else {
  await enqueueOrderStatusUpdate(...); // queue + localDb update
  qc.setQueryData(key, optimisticFn); // update RQ cache so UI reflects change
  toast.info("Saved offline — will sync when reconnected");
}
```

## Recovery
`recoverOrphanedStatusUpdates()` in recovery.ts: finds orders with `syncStatus === "pending_status_update"` that have no pending `update_order_status` queue entry (crash mid-write). Rebuilds the entry using `{ status: order.status }` as the best-effort changes.

**Why:** Without recovery, the order is stuck showing `pending_status_update` badge forever and the status never reaches the server.
