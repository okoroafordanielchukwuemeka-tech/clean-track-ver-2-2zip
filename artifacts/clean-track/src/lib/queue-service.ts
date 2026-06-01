/**
 * Queue Service — Phase 3A
 *
 * High-level typed wrappers around syncEngine.enqueue().
 * Handles the two offline-write surfaces: customer creation and order creation.
 *
 * Phase 3B will implement the actual sync logic in processQueue(),
 * syncCustomer() and syncOrder(). All three are intentional stubs for now.
 */

import { localDb, type LocalCustomer, type LocalOrder, type LocalOrderItem } from "./local-db";
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
 * Writes a pending customer to IndexedDB and adds a create_customer entry to
 * the sync queue. Returns after both writes are confirmed.
 */
export async function enqueueCustomerCreate(
  localId: string,
  record: LocalCustomer,
  payload: OfflineCustomerPayload
): Promise<void> {
  await localDb.customers.add(record);
  await syncEngine.enqueue(
    "create_customer",
    localId,
    payload as unknown as Record<string, unknown>
  );
}

/**
 * Writes a pending order + its line items to IndexedDB (in a single transaction)
 * and adds a create_order entry to the sync queue.
 */
export async function enqueueOrderCreate(
  localId: string,
  order: LocalOrder,
  items: LocalOrderItem[],
  payload: OfflineOrderPayload
): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.orders, localDb.orderItems],
    async () => {
      await localDb.orders.add(order);
      if (items.length > 0) {
        await localDb.orderItems.bulkAdd(items);
      }
    }
  );
  await syncEngine.enqueue(
    "create_order",
    localId,
    payload as unknown as Record<string, unknown>
  );
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
  // TODO Phase 3B:
  // const entry = await localDb.syncQueue.where("localId").equals(_localId).first();
  // const result = await api.customers.create(entry.payload);
  // await localDb.customers.where("localId").equals(_localId).modify({ serverId: result.id, syncStatus: "synced" });
}

/**
 * Phase 3B stub.
 * Will POST the pending order to /orders, update localDb.orders.serverId,
 * and patch back serverId on all related orderItems.
 */
export async function syncOrder(_localId: string): Promise<void> {
  // TODO Phase 3B:
  // const entry = await localDb.syncQueue.where("localId").equals(_localId).first();
  // const result = await api.orders.create(entry.payload);
  // await localDb.orders.where("localId").equals(_localId).modify({ serverId: result.id, orderId: result.orderId, syncStatus: "synced" });
  // await localDb.orderItems.where("orderLocalId").equals(_localId).modify({ orderId: result.id, syncStatus: "synced" });
}
