/**
 * Queue Service — Phase 3A.5
 *
 * High-level typed wrappers for offline write operations.
 * Handles customer creation and order creation while offline.
 *
 * ATOMICITY GUARANTEE (Phase 3A.5 hardening):
 * Both enqueue functions write the domain record AND the sync-queue entry
 * inside a single Dexie transaction. Either both writes succeed or neither
 * does — a crash mid-flight can never leave a pending_create record without
 * a corresponding queue entry.
 *
 * DEPENDENCY CHAINING (Phase 3A.5 hardening):
 * enqueueOrderCreate accepts a dependsOn array. When an order is placed for
 * an offline-created customer, pass [customerLocalId] so Phase 3B processes
 * the customer before the order.
 *
 * Phase 3B will implement processQueue(), syncCustomer(), and syncOrder().
 * All three remain stubs for now.
 */

import {
  localDb,
  type LocalCustomer,
  type LocalOrder,
  type LocalOrderItem,
  type SyncQueueEntry,
} from "./local-db";
import { syncEngine } from "./sync-engine";

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
 *   in the same session so Phase 3B processes customer before order.
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
 * Phase 3B stub.
 * Will iterate pending sync-queue entries in dependency order, call the
 * appropriate server endpoint for each, patch back the server-issued ID,
 * and mark entries as "done". No API calls are made here yet.
 */
export async function processQueue(): Promise<void> {
  // TODO Phase 3B:
  // 1. Fetch pending entries from localDb.syncQueue ordered by position
  // 2. For each entry: check that all dependsOn entries are "done"
  // 3. Call syncCustomer() or syncOrder() depending on entry.operation
  // 4. On success: mark entry "done", write syncLog
  // 5. On failure: increment attempts, apply exponential back-off, mark "failed" after max retries
}

/**
 * Phase 3B stub.
 * Will POST the pending customer to /customers and update localDb.customers.serverId.
 */
export async function syncCustomer(_localId: string): Promise<void> {
  // TODO Phase 3B
}

/**
 * Phase 3B stub.
 * Will POST the pending order to /orders, update localDb.orders.serverId,
 * and patch back serverId on all related orderItems.
 */
export async function syncOrder(_localId: string): Promise<void> {
  // TODO Phase 3B
}
