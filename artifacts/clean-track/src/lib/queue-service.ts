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
  type SyncQueueEntry,
} from "./local-db";
import { syncEngine } from "./sync-engine";
import { getIsOnline } from "./network-state";
import { api, type CustomerInput, type OrderInput } from "./api";

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

    try {
      await syncOrder(entry.localId);
      doneLocalIds.add(entry.localId);
    } catch {
      // syncOrder already logged the error and updated the queue entry.
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

    const response = await api.customers.create(serverPayload);
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
    const newAttempts = entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_ATTEMPTS;

    await localDb.syncQueue.update(entry.id!, {
      status: permanentlyFailed ? "failed" : "pending",
      attempts: newAttempts,
      lastError: error,
    });

    await localDb.syncLog.add({
      operation: "create_customer",
      localId,
      serverId: null,
      success: false,
      error,
      syncedAt: new Date().toISOString(),
    });

    if (permanentlyFailed) {
      console.error(
        `[CleanTrack Sync] Customer ${localId} permanently failed after ${newAttempts} attempts: ${error}`
      );
    } else {
      console.warn(
        `[CleanTrack Sync] Customer ${localId} sync attempt ${newAttempts}/${MAX_ATTEMPTS} failed: ${error}`
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

    const response = await api.orders.create(serverPayload);
    const serverId = response.id;

    // Patch the local order record with server ID and resolved customer ID.
    await localDb.orders.update(localId, {
      serverId,
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
    const newAttempts = entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_ATTEMPTS;

    await localDb.syncQueue.update(entry.id!, {
      status: permanentlyFailed ? "failed" : "pending",
      attempts: newAttempts,
      lastError: error,
    });

    await localDb.syncLog.add({
      operation: "create_order",
      localId,
      serverId: null,
      success: false,
      error,
      syncedAt: new Date().toISOString(),
    });

    if (permanentlyFailed) {
      console.error(
        `[CleanTrack Sync] Order ${localId} permanently failed after ${newAttempts} attempts: ${error}`
      );
    } else {
      console.warn(
        `[CleanTrack Sync] Order ${localId} sync attempt ${newAttempts}/${MAX_ATTEMPTS} failed: ${error}`
      );
    }

    throw err;
  }
}
