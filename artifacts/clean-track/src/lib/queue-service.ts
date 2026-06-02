/**
 * Queue Service — Phase 3B
 *
 * High-level typed wrappers for offline write operations.
 * Handles customer creation and order creation while offline.
 *
 * ATOMICITY GUARANTEE:
 * Both enqueue functions write the domain record AND the sync-queue entry
 * inside a single Dexie transaction. Either both writes succeed or neither
 * does — a crash mid-flight can never leave a pending_create record without
 * a corresponding queue entry.
 *
 * DEPENDENCY CHAINING:
 * enqueueOrderCreate accepts a dependsOn array. When an order is placed for
 * an offline-created customer, pass [customerLocalId] so processQueue()
 * processes the customer before the order.
 *
 * SYNC ORDERING:
 * processQueue() always processes create_customer entries before
 * create_order entries. Orders whose dependsOn contains an unresolved
 * localId are skipped until that localId reaches "done".
 */

import {
  localDb,
  type LocalCustomer,
  type LocalOrder,
  type LocalOrderItem,
  type LocalPayment,
  type LocalPickup,
  type SyncQueueEntry,
} from "./local-db";
import { syncEngine } from "./sync-engine";
import { getIsOnline } from "./network-state";
import { api, HttpError, type CustomerInput, type OrderInput, type PickupInput } from "./api";

// ── Retry helpers ─────────────────────────────────────────────────────────────

/**
 * Exponential back-off delay for a queue entry.
 *
 * Delay schedule (capped at 60 s):
 *   attempts=1 →  2 s
 *   attempts=2 →  4 s
 *   attempts=3 →  8 s
 *   attempts=4 → 16 s  …
 *
 * Returns 0 when attempts=0 (first try — no delay needed).
 */
function computeBackoffMs(attempts: number): number {
  if (attempts === 0) return 0;
  return Math.min(Math.pow(2, attempts) * 1_000, 60_000);
}

/**
 * Returns true when an entry is ready to be retried.
 * A fresh entry (attempts=0) is always ready.
 * A previously-failed entry must have waited at least computeBackoffMs(attempts) ms.
 */
function isBackoffExpired(entry: SyncQueueEntry): boolean {
  if (entry.attempts === 0 || !entry.lastAttemptAt) return true;
  const elapsed = Date.now() - new Date(entry.lastAttemptAt).getTime();
  return elapsed >= computeBackoffMs(entry.attempts);
}

/**
 * Returns true when the error represents a client-side validation failure
 * (HTTP 4xx, excluding 408 Request Timeout and 429 Too Many Requests which
 * are both transient and should be retried normally).
 *
 * 4xx errors indicate bad data that will never succeed — retrying wastes
 * network requests and fills up the log. Mark them permanently failed immediately.
 */
function isClientError(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  const { status } = err;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export interface OfflineStatusPayload {
  localId: string;
  serverId: number | null;
  changes: Record<string, unknown>;
  timestamp: string;
}

export interface OfflinePaymentPayload {
  orderLocalId: string;
  serverId: number | null;
  amount: number;
  method: "cash" | "transfer" | "pos";
  notes: string | null;
  laundryId: number;
  branchId: number | null;
  timestamp: string;
}

/**
 * Payload stored in the sync queue for a record_pickup operation.
 *
 * items: server-side order item IDs for item-based orders. null for legacy
 *   shirt/trouser-based orders.
 * serverId: the server order ID at enqueue time (null when the order was
 *   created offline in the same session and hasn't synced yet).
 */
export interface OfflinePickupPayload {
  orderLocalId: string;
  serverId: number | null;
  items: Array<{ orderItemId: number; quantity: number; name: string }> | null;
  shirtsPickedUp: number;
  trousersPickedUp: number;
  notes: string | null;
  laundryId: number;
  timestamp: string;
}

export interface OfflineCustomerPayload {
  fullName: string;
  phone: string;
  address?: string | null;
  notes?: string | null;
  branchId?: number | null;
  laundryId?: number | null;
}

export interface OfflineOrderPayload {
  customerName: string;
  phone: string;
  address?: string | null;
  customerId?: number | null;
  customerLocalId?: string | null;
  serviceType: "standard" | "express" | "premium";
  items: Array<{ serviceId: number; quantity: number }>;
  additionalNotes?: string | null;
  discount?: number | null;
  discountReason?: string | null;
  extraCharge?: number | null;
  extraChargeReason?: string | null;
  branchId?: number | null;
  laundryId?: number | null;
}

const MAX_ATTEMPTS = 3;

/**
 * Atomically writes a pending customer to IndexedDB and adds a
 * create_customer entry to the sync queue in a single Dexie transaction.
 */
export async function enqueueCustomerCreate(
  localId: string,
  record: LocalCustomer,
  payload: OfflineCustomerPayload
): Promise<void> {
  const entry: SyncQueueEntry = {
    clientId: crypto.randomUUID(),
    position: Date.now(),
    operation: "create_customer",
    payload: payload as unknown as Record<string, unknown>,
    localId,
    dependsOn: [],
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await localDb.transaction(
    "rw",
    [localDb.customers, localDb.syncQueue],
    async () => {
      await localDb.customers.add(record);
      await localDb.syncQueue.add(entry);
    }
  );

  await syncEngine.notifyQueueChanged();
}

/**
 * Atomically writes a pending order + its line items to IndexedDB and adds a
 * create_order entry to the sync queue — all in a single Dexie transaction.
 *
 * @param dependsOn — localIds of records that must be synced before this
 *   order. Pass [customerLocalId] when the customer was also created offline
 *   in the same session so processQueue() handles customer before order.
 */
export async function enqueueOrderCreate(
  localId: string,
  order: LocalOrder,
  items: LocalOrderItem[],
  payload: OfflineOrderPayload,
  dependsOn: string[] = []
): Promise<void> {
  const entry: SyncQueueEntry = {
    clientId: crypto.randomUUID(),
    position: Date.now(),
    operation: "create_order",
    payload: payload as unknown as Record<string, unknown>,
    localId,
    dependsOn,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await localDb.transaction(
    "rw",
    [localDb.orders, localDb.orderItems, localDb.syncQueue],
    async () => {
      await localDb.orders.add(order);
      if (items.length > 0) {
        await localDb.orderItems.bulkAdd(items);
      }
      await localDb.syncQueue.add(entry);
    }
  );

  await syncEngine.notifyQueueChanged();
}

/**
 * Enqueues an offline order status/field update.
 *
 * Two usage modes:
 *  A) Server-synced order  (serverId is known, no local record or syncStatus="synced")
 *     – Adds a queue entry with localId="srv-<serverId>".
 *     – Also updates localDb.orders syncStatus → "pending_status_update" if a
 *       local record exists, so the pending badge shows correctly.
 *  B) Locally-created order (syncStatus="pending_create", serverId=null)
 *     – Adds a queue entry with dependsOn=[localId] so it waits for create_order.
 *     – Updates localDb.orders status field optimistically.
 *
 * The queue entry payload carries the full `changes` object so syncOrderStatusEntry
 * can PATCH exactly that data to the server.
 */
export async function enqueueOrderStatusUpdate(
  localId: string,
  serverId: number | null,
  changes: Record<string, unknown>
): Promise<void> {
  const payload: OfflineStatusPayload = {
    localId,
    serverId,
    changes,
    timestamp: new Date().toISOString(),
  };

  const existingLocalOrder = localId.startsWith("srv-")
    ? null
    : await localDb.orders.get(localId);

  const dependsOn: string[] =
    existingLocalOrder?.syncStatus === "pending_create" ? [localId] : [];

  const entry: SyncQueueEntry = {
    clientId: crypto.randomUUID(),
    position: Date.now(),
    operation: "update_order_status",
    payload: payload as unknown as Record<string, unknown>,
    localId,
    dependsOn,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await localDb.transaction(
    "rw",
    [localDb.orders, localDb.syncQueue],
    async () => {
      if (existingLocalOrder) {
        const localUpdates: Partial<typeof existingLocalOrder> = {};
        if (typeof changes.status === "string") {
          localUpdates.status = changes.status;
        }
        if (existingLocalOrder.syncStatus === "synced") {
          localUpdates.syncStatus = "pending_status_update";
        }
        if (Object.keys(localUpdates).length > 0) {
          await localDb.orders.update(localId, localUpdates);
        }
      }
      await localDb.syncQueue.add(entry);
    }
  );

  await syncEngine.notifyQueueChanged();
}

/**
 * Atomically writes a pending payment to IndexedDB and adds a
 * record_payment entry to the sync queue in a single Dexie transaction.
 *
 * Dependency rule:
 *  - If serverId is null (the order itself is pending_create), pass
 *    dependsOn=[orderLocalId] so processQueue() waits for create_order first.
 *  - If serverId is already known (order is synced), pass dependsOn=[].
 */
export async function enqueuePayment(
  localId: string,
  record: LocalPayment,
  payload: OfflinePaymentPayload,
  dependsOn: string[] = []
): Promise<void> {
  const entry: SyncQueueEntry = {
    clientId: crypto.randomUUID(),
    position: Date.now(),
    operation: "record_payment",
    payload: payload as unknown as Record<string, unknown>,
    localId,
    dependsOn,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await localDb.transaction(
    "rw",
    [localDb.payments, localDb.syncQueue],
    async () => {
      await localDb.payments.add(record);
      await localDb.syncQueue.add(entry);
    }
  );

  await syncEngine.notifyQueueChanged();
}

/**
 * Atomically writes a pending pickup to IndexedDB and adds a
 * record_pickup entry to the sync queue in a single Dexie transaction.
 *
 * Dependency rules (auto-computed):
 *  - Server-synced orders (serverId known): dependsOn = []
 *  - Offline-created orders (serverId = null):
 *      • dependsOn includes [orderLocalId] — waits for create_order
 *      • dependsOn includes any pending payment localIds for this order
 *        so pickups never reach the server before outstanding payments
 *
 * Pass ordering (Pass 5 runs after customers, orders, status updates,
 * and payments) already guarantees same-cycle ordering.  The explicit
 * dependsOn guards against cross-cycle stale state.
 */
export async function enqueuePickup(
  localId: string,
  record: LocalPickup,
  payload: OfflinePickupPayload
): Promise<void> {
  const dependsOn: string[] = [];
  const isOfflineOrder =
    !payload.serverId && !payload.orderLocalId.startsWith("srv-");

  if (isOfflineOrder) {
    // Must wait for the order itself to be created on the server.
    dependsOn.push(payload.orderLocalId);

    // Also explicitly depend on any pending payments for this order so
    // their localIds are in doneLocalIds before we attempt the pickup.
    const pendingPaymentEntries = await localDb.syncQueue
      .where("status")
      .anyOf(["pending", "in_flight"])
      .filter(
        (e) =>
          e.operation === "record_payment" &&
          (e.payload as unknown as OfflinePaymentPayload).orderLocalId ===
            payload.orderLocalId
      )
      .toArray();

    for (const e of pendingPaymentEntries) {
      if (!dependsOn.includes(e.localId)) {
        dependsOn.push(e.localId);
      }
    }
  }

  const entry: SyncQueueEntry = {
    clientId: crypto.randomUUID(),
    position: Date.now(),
    operation: "record_pickup",
    payload: payload as unknown as Record<string, unknown>,
    localId,
    dependsOn,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await localDb.transaction(
    "rw",
    [localDb.pickups, localDb.syncQueue],
    async () => {
      await localDb.pickups.add(record);
      await localDb.syncQueue.add(entry);
    }
  );

  await syncEngine.notifyQueueChanged();
}

/**
 * Process the offline write queue in strict dependency order.
 *
 * Ordering rules:
 *  1. create_customer entries are always processed before create_order entries.
 *  2. A create_order entry is only processed once every localId listed in its
 *     dependsOn array has status "done" in the queue.
 *  3. If a customer sync fails after MAX_ATTEMPTS, dependent orders are skipped
 *     for this cycle (they will remain pending until manually resolved).
 *
 * In-flight recovery:
 *  Any entries still marked "in_flight" at the start of a cycle were left
 *  stranded by a previous crash. They are reset to "pending" before processing.
 */
export async function processQueue(): Promise<void> {
  if (!getIsOnline()) return;

  // Reset any entries stuck in_flight from a previous crashed run.
  const stuckEntries = await localDb.syncQueue
    .where("status")
    .equals("in_flight")
    .toArray();
  if (stuckEntries.length > 0) {
    await localDb.syncQueue.bulkUpdate(
      stuckEntries.map((e) => ({ key: e.id!, changes: { status: "pending" as const } }))
    );
  }

  // Fetch all pending entries sorted by enqueue position (ascending).
  const pending = await localDb.syncQueue
    .where("status")
    .equals("pending")
    .sortBy("position");

  if (pending.length === 0) return;

  // Build the set of already-done localIds (needed for dependency checks).
  const doneEntries = await localDb.syncQueue
    .where("status")
    .equals("done")
    .toArray();
  const doneLocalIds = new Set<string>(doneEntries.map((e) => e.localId));

  // ── Pass 1: sync all pending customers ───────────────────────────────────
  // Customers have no dependsOn and must always be resolved before orders.
  const customerEntries = pending.filter(
    (e) => e.operation === "create_customer"
  );

  for (const entry of customerEntries) {
    // Skip entries still within their exponential back-off window.
    if (!isBackoffExpired(entry)) {
      console.debug(
        `[CleanTrack Sync] Customer ${entry.localId} in back-off (attempt ${entry.attempts}), skipping this cycle`
      );
      continue;
    }

    try {
      await syncCustomer(entry.localId);
      doneLocalIds.add(entry.localId);
    } catch {
      // syncCustomer already logged the error and updated the queue entry.
      // Do not add to doneLocalIds — dependent orders will be skipped below.
    }
  }

  // ── Pass 2: sync pending orders whose dependencies are fully resolved ────
  const orderEntries = pending.filter((e) => e.operation === "create_order");

  for (const entry of orderEntries) {
    const allDepsResolved = entry.dependsOn.every((dep) =>
      doneLocalIds.has(dep)
    );
    if (!allDepsResolved) {
      // A required customer has not yet synced (or permanently failed).
      // Leave this order pending — it will be retried on the next cycle.
      console.warn(
        `[CleanTrack Sync] Skipping order ${entry.localId} — unresolved dependencies: ` +
          entry.dependsOn.filter((d) => !doneLocalIds.has(d)).join(", ")
      );
      continue;
    }

    // Skip entries still within their exponential back-off window.
    if (!isBackoffExpired(entry)) {
      console.debug(
        `[CleanTrack Sync] Order ${entry.localId} in back-off (attempt ${entry.attempts}), skipping this cycle`
      );
      continue;
    }

    try {
      await syncOrder(entry.localId);
      doneLocalIds.add(entry.localId);
    } catch {
      // syncOrder already logged the error and updated the queue entry.
    }
  }

  // ── Pass 3: sync pending order status/field updates ──────────────────────
  // These wait for their dependsOn (a create_order localId) to finish first.
  const statusEntries = pending.filter(
    (e) => e.operation === "update_order_status"
  );

  // ── Last-write-wins deduplication ──────────────────────────────────────
  // Multiple offline status changes for the same order (e.g. pending →
  // processing → ready → completed) all share the same localId.  Sending
  // them in order is correct but wasteful and can leave the server briefly
  // in intermediate states.  Instead, keep only the most-recently enqueued
  // entry per order and immediately mark earlier ones done without a server
  // call — the winning entry carries the authoritative final state.
  //
  // `statusEntries` is already sorted by position ascending, so iterating
  // and overwriting means the last entry for each localId survives.
  const latestByOrder = new Map<string, SyncQueueEntry>();
  for (const entry of statusEntries) {
    latestByOrder.set(entry.localId, entry);
  }

  const staleStatusEntries = statusEntries.filter(
    (e) => latestByOrder.get(e.localId)?.id !== e.id
  );
  if (staleStatusEntries.length > 0) {
    await localDb.syncQueue.bulkUpdate(
      staleStatusEntries.map((e) => ({
        key: e.id!,
        changes: { status: "done" as const },
      }))
    );
    console.info(
      `[CleanTrack Sync] Last-write-wins: collapsed ${staleStatusEntries.length} ` +
        `stale status update(s) — only sending latest per order`
    );
  }

  // Process only the winning (latest) entry per order.
  const dedupedStatusEntries = [...latestByOrder.values()];

  for (const entry of dedupedStatusEntries) {
    const allDepsResolved = entry.dependsOn.every((dep) =>
      doneLocalIds.has(dep)
    );
    if (!allDepsResolved) {
      console.warn(
        `[CleanTrack Sync] Skipping status update for ${entry.localId} — unresolved dependencies: ` +
          entry.dependsOn.filter((d) => !doneLocalIds.has(d)).join(", ")
      );
      continue;
    }

    // Skip entries still within their exponential back-off window.
    if (!isBackoffExpired(entry)) {
      console.debug(
        `[CleanTrack Sync] Status update ${entry.localId} in back-off ` +
          `(attempt ${entry.attempts}), skipping this cycle`
      );
      continue;
    }

    try {
      await syncOrderStatusEntry(entry);
      // Add to doneLocalIds so same-cycle pickup deps resolve correctly.
      // Status update localId = the order's localId (shared key).
      doneLocalIds.add(entry.localId);
    } catch {
      // syncOrderStatusEntry already logged and updated the queue entry.
    }
  }

  // ── Pass 4: sync pending payments ────────────────────────────────────────
  // Payments for offline-created orders depend on create_order completing first.
  // Payments for server-synced orders have no dependencies and go straight through.
  const paymentEntries = pending.filter(
    (e) => e.operation === "record_payment"
  );

  for (const entry of paymentEntries) {
    const allDepsResolved = entry.dependsOn.every((dep) =>
      doneLocalIds.has(dep)
    );
    if (!allDepsResolved) {
      console.warn(
        `[CleanTrack Sync] Skipping payment ${entry.localId} — unresolved dependencies: ` +
          entry.dependsOn.filter((d) => !doneLocalIds.has(d)).join(", ")
      );
      continue;
    }

    try {
      await syncPaymentEntry(entry);
      // Propagate into doneLocalIds so pickup deps resolve in this same cycle.
      doneLocalIds.add(entry.localId);
    } catch {
      // syncPaymentEntry already logged and updated the queue entry.
    }
  }

  // ── Pass 5: sync pending pickups ─────────────────────────────────────────
  // Pickups run last so that create_order, status updates, and payments for
  // the same order are already committed server-side before the pickup POST.
  // For offline-created orders, dependsOn explicitly lists the order localId
  // plus any payment localIds computed at enqueuePickup() time.
  const pickupEntries = pending.filter(
    (e) => e.operation === "record_pickup"
  );

  for (const entry of pickupEntries) {
    const allDepsResolved = entry.dependsOn.every((dep) =>
      doneLocalIds.has(dep)
    );
    if (!allDepsResolved) {
      console.warn(
        `[CleanTrack Sync] Skipping pickup ${entry.localId} — unresolved dependencies: ` +
          entry.dependsOn.filter((d) => !doneLocalIds.has(d)).join(", ")
      );
      continue;
    }

    try {
      await syncPickupEntry(entry);
      doneLocalIds.add(entry.localId);
    } catch {
      // syncPickupEntry already logged and updated the queue entry.
    }
  }
}

/**
 * POST a pending customer to the server, then patch the local record.
 *
 * On success:
 *  - localDb.customers → serverId set, syncStatus = "synced"
 *  - syncQueue entry   → status = "done"
 *  - syncLog           → success entry written
 *
 * On failure (< MAX_ATTEMPTS):
 *  - syncQueue entry   → status = "pending", attempts incremented
 *  - syncLog           → error entry written
 *
 * On permanent failure (>= MAX_ATTEMPTS):
 *  - syncQueue entry   → status = "failed"
 *  - syncLog           → error entry written
 *  - Throws so processQueue can skip dependent orders
 */
export async function syncCustomer(localId: string): Promise<void> {
  const allEntries = await localDb.syncQueue
    .where("localId")
    .equals(localId)
    .toArray();
  const entry = allEntries.find((e) => e.operation === "create_customer");
  if (!entry) return;

  // Already permanently failed — do not retry.
  if (entry.attempts >= MAX_ATTEMPTS) {
    throw new Error(
      `Customer ${localId} has reached max sync attempts and is permanently failed`
    );
  }

  // Mark in_flight before the network call.
  await localDb.syncQueue.update(entry.id!, {
    status: "in_flight",
    lastAttemptAt: new Date().toISOString(),
  });

  try {
    const p = entry.payload as unknown as OfflineCustomerPayload;

    // Build a payload shaped exactly as the server expects.
    const serverPayload: CustomerInput = {
      fullName: p.fullName,
      phone: p.phone,
      ...(p.address != null && { address: p.address }),
      ...(p.notes != null && { notes: p.notes }),
    };

    const response = await api.customers.create(serverPayload, entry.clientId);
    const serverId = response.id;

    // Patch the local customer record with the server-issued ID.
    await localDb.customers.update(localId, {
      serverId,
      syncStatus: "synced",
    });

    // Mark the queue entry done.
    await localDb.syncQueue.update(entry.id!, { status: "done" });

    // Write a success sync log entry.
    await localDb.syncLog.add({
      operation: "create_customer",
      localId,
      serverId,
      success: true,
      error: null,
      syncedAt: new Date().toISOString(),
    });

    console.info(
      `[CleanTrack Sync] Customer synced: localId=${localId} → serverId=${serverId}`
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // 4xx validation errors will never succeed — permanently fail immediately
    // without consuming retry slots so the log is not polluted with retries.
    const clientErr = isClientError(err);
    const newAttempts = clientErr ? MAX_ATTEMPTS : entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_ATTEMPTS;

    await localDb.syncQueue.update(entry.id!, {
      status: permanentlyFailed ? "failed" : "pending",
      attempts: newAttempts,
      lastError: error,
      lastAttemptAt: new Date().toISOString(),
    });

    await localDb.syncLog.add({
      operation: "create_customer",
      localId,
      serverId: null,
      success: false,
      error,
      syncedAt: new Date().toISOString(),
    });

    if (clientErr) {
      console.error(
        `[CleanTrack Sync] Customer ${localId} permanently failed (4xx — not retryable): ${error}`
      );
    } else if (permanentlyFailed) {
      console.error(
        `[CleanTrack Sync] Customer ${localId} permanently failed after ${newAttempts} attempts: ${error}`
      );
    } else {
      const nextBackoffSec = Math.round(computeBackoffMs(newAttempts) / 1_000);
      console.warn(
        `[CleanTrack Sync] Customer ${localId} sync attempt ${newAttempts}/${MAX_ATTEMPTS} failed ` +
          `(retry in ${nextBackoffSec}s): ${error}`
      );
    }

    throw err;
  }
}

/**
 * POST a pending order to the server, then patch the local record and its items.
 *
 * Before posting:
 *  - Resolves customerLocalId → server customerId by reading the local customer
 *    record's serverId (which must have been set by syncCustomer() first).
 *
 * On success:
 *  - localDb.orders     → serverId set, syncStatus = "synced", customerId updated
 *  - localDb.orderItems → orderId set, syncStatus = "synced" for all items
 *  - syncQueue entry    → status = "done"
 *  - syncLog            → success entry written
 *
 * On failure (< MAX_ATTEMPTS):
 *  - syncQueue entry → status = "pending", attempts incremented
 *  - syncLog         → error entry written
 *
 * On permanent failure (>= MAX_ATTEMPTS):
 *  - syncQueue entry → status = "failed"
 *  - syncLog         → error entry written
 */
export async function syncOrder(localId: string): Promise<void> {
  const allEntries = await localDb.syncQueue
    .where("localId")
    .equals(localId)
    .toArray();
  const entry = allEntries.find((e) => e.operation === "create_order");
  if (!entry) return;

  if (entry.attempts >= MAX_ATTEMPTS) {
    throw new Error(
      `Order ${localId} has reached max sync attempts and is permanently failed`
    );
  }

  // Mark in_flight before the network call.
  await localDb.syncQueue.update(entry.id!, {
    status: "in_flight",
    lastAttemptAt: new Date().toISOString(),
  });

  try {
    const p = entry.payload as unknown as OfflineOrderPayload;

    // Resolve customerLocalId → server customerId.
    let resolvedCustomerId: number | null = p.customerId ?? null;
    if (p.customerLocalId) {
      const localCustomer = await localDb.customers.get(p.customerLocalId);
      if (!localCustomer?.serverId) {
        throw new Error(
          `Cannot sync order ${localId}: customer ${p.customerLocalId} has no serverId yet`
        );
      }
      resolvedCustomerId = localCustomer.serverId;
    }

    // Build the payload shaped exactly as the server expects.
    const serverPayload: OrderInput = {
      customerName: p.customerName,
      phone: p.phone,
      ...(p.address != null && { address: p.address }),
      ...(resolvedCustomerId != null && { customerId: resolvedCustomerId }),
      ...(p.serviceType && { serviceType: p.serviceType }),
      ...(p.items?.length && { items: p.items }),
      ...(p.additionalNotes != null && { additionalNotes: p.additionalNotes }),
      ...(p.discount != null && { discount: p.discount }),
      ...(p.discountReason != null && { discountReason: p.discountReason }),
      ...(p.extraCharge != null && { extraCharge: p.extraCharge }),
      ...(p.extraChargeReason != null && {
        extraChargeReason: p.extraChargeReason,
      }),
      ...(p.branchId != null && { branchId: p.branchId }),
    };

    const response = await api.orders.create(serverPayload, entry.clientId);
    const serverId = response.id;

    // Patch the local order record with server ID, server-issued orderId string,
    // and resolved customer ID so the UI shows the canonical reference number.
    await localDb.orders.update(localId, {
      serverId,
      orderId: response.orderId ?? null,
      syncStatus: "synced",
      ...(resolvedCustomerId != null && { customerId: resolvedCustomerId }),
    });

    // Patch all order items with the server-issued orderId.
    const items = await localDb.orderItems
      .where("orderLocalId")
      .equals(localId)
      .toArray();

    if (items.length > 0) {
      await localDb.orderItems.bulkUpdate(
        items.map((item) => ({
          key: item.localId,
          changes: { orderId: serverId, syncStatus: "synced" as const },
        }))
      );
    }

    // Mark the queue entry done.
    await localDb.syncQueue.update(entry.id!, { status: "done" });

    // Write a success sync log entry.
    await localDb.syncLog.add({
      operation: "create_order",
      localId,
      serverId,
      success: true,
      error: null,
      syncedAt: new Date().toISOString(),
    });

    console.info(
      `[CleanTrack Sync] Order synced: localId=${localId} → serverId=${serverId}` +
        (resolvedCustomerId ? ` (customerId=${resolvedCustomerId})` : "")
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // 4xx validation errors will never succeed — permanently fail immediately.
    const clientErr = isClientError(err);
    const newAttempts = clientErr ? MAX_ATTEMPTS : entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_ATTEMPTS;

    await localDb.syncQueue.update(entry.id!, {
      status: permanentlyFailed ? "failed" : "pending",
      attempts: newAttempts,
      lastError: error,
      lastAttemptAt: new Date().toISOString(),
    });

    await localDb.syncLog.add({
      operation: "create_order",
      localId,
      serverId: null,
      success: false,
      error,
      syncedAt: new Date().toISOString(),
    });

    if (clientErr) {
      console.error(
        `[CleanTrack Sync] Order ${localId} permanently failed (4xx — not retryable): ${error}`
      );
    } else if (permanentlyFailed) {
      console.error(
        `[CleanTrack Sync] Order ${localId} permanently failed after ${newAttempts} attempts: ${error}`
      );
    } else {
      const nextBackoffSec = Math.round(computeBackoffMs(newAttempts) / 1_000);
      console.warn(
        `[CleanTrack Sync] Order ${localId} sync attempt ${newAttempts}/${MAX_ATTEMPTS} failed ` +
          `(retry in ${nextBackoffSec}s): ${error}`
      );
    }

    throw err;
  }
}

/**
 * PATCH a pending order status/field update to the server.
 *
 * Resolves the server order ID from:
 *  1. payload.serverId (fast path — set at enqueue time for server-synced orders)
 *  2. localDb.orders.get(localId).serverId (for offline-created orders after create_order syncs)
 *
 * On success:
 *  - syncQueue entry   → status = "done"
 *  - localDb.orders    → syncStatus = "synced" if no other pending status-update entries remain
 *  - syncLog           → success entry written
 *
 * On failure (< MAX_ATTEMPTS):
 *  - syncQueue entry   → status = "pending", attempts incremented
 *
 * On permanent failure (>= MAX_ATTEMPTS):
 *  - syncQueue entry   → status = "failed"
 */
export async function syncOrderStatusEntry(entry: SyncQueueEntry): Promise<void> {
  if (entry.attempts >= MAX_ATTEMPTS) {
    throw new Error(
      `Status update entry ${entry.id} for order ${entry.localId} reached max sync attempts`
    );
  }

  await localDb.syncQueue.update(entry.id!, {
    status: "in_flight",
    lastAttemptAt: new Date().toISOString(),
  });

  try {
    const p = entry.payload as unknown as OfflineStatusPayload;

    let serverId = p.serverId ?? null;
    if (!serverId && !p.localId.startsWith("srv-")) {
      const localOrder = await localDb.orders.get(p.localId);
      serverId = localOrder?.serverId ?? null;
    }

    if (!serverId) {
      throw new Error(
        `Cannot sync status update for order ${p.localId}: serverId not available yet`
      );
    }

    await api.orders.update(serverId, p.changes as Record<string, unknown>, entry.clientId);

    await localDb.syncQueue.update(entry.id!, { status: "done" });

    const remainingPending = await localDb.syncQueue
      .where("localId")
      .equals(p.localId)
      .filter(
        (e) =>
          e.operation === "update_order_status" &&
          e.status === "pending" &&
          e.id !== entry.id
      )
      .count();

    if (remainingPending === 0 && !p.localId.startsWith("srv-")) {
      const localOrder = await localDb.orders.get(p.localId);
      if (localOrder?.syncStatus === "pending_status_update") {
        await localDb.orders.update(p.localId, { syncStatus: "synced" });
      }
    }

    await localDb.syncLog.add({
      operation: "update_order_status",
      localId: p.localId,
      serverId,
      success: true,
      error: null,
      syncedAt: new Date().toISOString(),
    });

    console.info(
      `[CleanTrack Sync] Order status update synced: localId=${p.localId} serverId=${serverId}`
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // 4xx validation errors will never succeed — permanently fail immediately.
    const clientErr = isClientError(err);
    const newAttempts = clientErr ? MAX_ATTEMPTS : entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_ATTEMPTS;

    await localDb.syncQueue.update(entry.id!, {
      status: permanentlyFailed ? "failed" : "pending",
      attempts: newAttempts,
      lastError: error,
      lastAttemptAt: new Date().toISOString(),
    });

    await localDb.syncLog.add({
      operation: "update_order_status",
      localId: entry.localId,
      serverId: null,
      success: false,
      error,
      syncedAt: new Date().toISOString(),
    });

    if (clientErr) {
      console.error(
        `[CleanTrack Sync] Status update ${entry.id} permanently failed (4xx — not retryable): ${error}`
      );
    } else if (permanentlyFailed) {
      console.error(
        `[CleanTrack Sync] Status update ${entry.id} permanently failed after ${newAttempts} attempts: ${error}`
      );
    } else {
      const nextBackoffSec = Math.round(computeBackoffMs(newAttempts) / 1_000);
      console.warn(
        `[CleanTrack Sync] Status update ${entry.id} attempt ${newAttempts}/${MAX_ATTEMPTS} failed ` +
          `(retry in ${nextBackoffSec}s): ${error}`
      );
    }

    throw err;
  }
}

/**
 * POST a pending payment to the server, then patch the local record with the
 * server-issued receipt number.
 *
 * On success:
 *  - localDb.payments → orderId set, receiptNumber set, syncStatus = "synced"
 *  - syncQueue entry   → status = "done"
 *  - syncLog           → success entry written
 *
 * On failure (< MAX_ATTEMPTS): status reset to "pending", attempts incremented.
 * On failure (= MAX_ATTEMPTS): status set to "failed".
 */
export async function syncPaymentEntry(entry: SyncQueueEntry): Promise<void> {
  if (entry.attempts >= MAX_ATTEMPTS) {
    throw new Error(`Payment ${entry.id} reached max sync attempts`);
  }

  await localDb.syncQueue.update(entry.id!, {
    status: "in_flight",
    lastAttemptAt: new Date().toISOString(),
  });

  try {
    const p = entry.payload as unknown as OfflinePaymentPayload;

    let serverOrderId = p.serverId ?? null;
    if (!serverOrderId) {
      const localOrder = await localDb.orders.get(p.orderLocalId);
      serverOrderId = localOrder?.serverId ?? null;
    }

    if (!serverOrderId) {
      throw new Error(
        `Cannot sync payment for order ${p.orderLocalId}: server order ID not available yet`
      );
    }

    const response = await api.orders.recordPayment(serverOrderId, {
      amount: p.amount,
      method: p.method,
      ...(p.notes ? { notes: p.notes } : {}),
    }, entry.clientId);

    await localDb.payments.update(entry.localId, {
      orderId: serverOrderId,
      receiptNumber: response.receiptNumber ?? null,
      syncStatus: "synced",
    });

    await localDb.syncQueue.update(entry.id!, { status: "done" });

    await localDb.syncLog.add({
      operation: "record_payment",
      localId: entry.localId,
      serverId: response.id,
      success: true,
      error: null,
      syncedAt: new Date().toISOString(),
    });

    console.info(
      `[CleanTrack Sync] Payment synced: localId=${entry.localId} → serverId=${response.id} receiptNumber=${response.receiptNumber}`
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const newAttempts = entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_ATTEMPTS;

    await localDb.syncQueue.update(entry.id!, {
      status: permanentlyFailed ? "failed" : "pending",
      attempts: newAttempts,
      lastError: error,
    });

    await localDb.syncLog.add({
      operation: "record_payment",
      localId: entry.localId,
      serverId: null,
      success: false,
      error,
      syncedAt: new Date().toISOString(),
    });

    if (permanentlyFailed) {
      console.error(
        `[CleanTrack Sync] Payment ${entry.id} permanently failed after ${newAttempts} attempts: ${error}`
      );
    } else {
      console.warn(
        `[CleanTrack Sync] Payment ${entry.id} attempt ${newAttempts}/${MAX_ATTEMPTS} failed: ${error}`
      );
    }

    throw err;
  }
}

/**
 * POST a pending pickup to the server, then patch the local record.
 *
 * Server-ID resolution (in priority order):
 *  1. payload.serverId              — set at enqueue time for server-synced orders
 *  2. "srv-<N>" prefix extraction   — for server-synced orders using the prefix convention
 *  3. localDb.orders.get(localId)   — for offline-created orders after create_order synced
 *
 * On success:
 *  - localDb.pickups   → orderId set, syncStatus = "synced"
 *  - syncQueue entry   → status = "done"
 *  - syncLog           → success entry written
 *
 * On failure (< MAX_ATTEMPTS):
 *  - syncQueue entry   → status = "pending", attempts incremented
 *  - syncLog           → error entry written
 *
 * On permanent failure (>= MAX_ATTEMPTS):
 *  - syncQueue entry   → status = "failed"
 *  - syncLog           → error entry written
 */
export async function syncPickupEntry(entry: SyncQueueEntry): Promise<void> {
  if (entry.attempts >= MAX_ATTEMPTS) {
    throw new Error(
      `Pickup ${entry.id} for order ${entry.localId} has reached max sync attempts`
    );
  }

  await localDb.syncQueue.update(entry.id!, {
    status: "in_flight",
    lastAttemptAt: new Date().toISOString(),
  });

  try {
    const p = entry.payload as unknown as OfflinePickupPayload;

    // ── Resolve server order ID ──────────────────────────────────────────
    let serverOrderId: number | null = p.serverId ?? null;

    if (!serverOrderId) {
      if (p.orderLocalId.startsWith("srv-")) {
        const parsed = parseInt(p.orderLocalId.slice(4), 10);
        serverOrderId = Number.isFinite(parsed) ? parsed : null;
      } else {
        const localOrder = await localDb.orders.get(p.orderLocalId);
        serverOrderId = localOrder?.serverId ?? null;
      }
    }

    if (!serverOrderId) {
      throw new Error(
        `Cannot sync pickup for order ${p.orderLocalId}: server order ID not available yet`
      );
    }

    // ── Build server payload ─────────────────────────────────────────────
    const serverPayload: PickupInput = {
      shirtsPickedUp: p.shirtsPickedUp,
      trousersPickedUp: p.trousersPickedUp,
      ...(p.notes ? { notes: p.notes } : {}),
      ...(p.items && p.items.length > 0
        ? {
            items: p.items.map((i) => ({
              orderItemId: i.orderItemId,
              quantity: i.quantity,
            })),
          }
        : {}),
    };

    const response = await api.pickups.record(serverOrderId, serverPayload, entry.clientId);

    // ── Patch local records ──────────────────────────────────────────────
    await localDb.pickups.update(entry.localId, {
      orderId: serverOrderId,
      syncStatus: "synced",
    });

    await localDb.syncQueue.update(entry.id!, { status: "done" });

    await localDb.syncLog.add({
      operation: "record_pickup",
      localId: entry.localId,
      serverId: response.pickup.id,
      success: true,
      error: null,
      syncedAt: new Date().toISOString(),
    });

    console.info(
      `[CleanTrack Sync] Pickup synced: localId=${entry.localId} → serverId=${response.pickup.id} (orderId=${serverOrderId})`
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const newAttempts = entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_ATTEMPTS;

    await localDb.syncQueue.update(entry.id!, {
      status: permanentlyFailed ? "failed" : "pending",
      attempts: newAttempts,
      lastError: error,
    });

    await localDb.syncLog.add({
      operation: "record_pickup",
      localId: entry.localId,
      serverId: null,
      success: false,
      error,
      syncedAt: new Date().toISOString(),
    });

    if (permanentlyFailed) {
      console.error(
        `[CleanTrack Sync] Pickup ${entry.id} permanently failed after ${newAttempts} attempts: ${error}`
      );
    } else {
      console.warn(
        `[CleanTrack Sync] Pickup ${entry.id} attempt ${newAttempts}/${MAX_ATTEMPTS} failed: ${error}`
      );
    }

    throw err;
  }
}
