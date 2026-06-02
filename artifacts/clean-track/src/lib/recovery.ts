/**
 * Phase 3A.5 — Orphaned Pending Record Recovery
 *
 * Runs once at application startup via main.tsx.
 *
 * Detects LocalCustomer and LocalOrder records that have
 * syncStatus === "pending_create" but no corresponding entry in the syncQueue.
 * This can happen when the app is killed between the domain-table write and
 * the queue write (a race that the Phase 3A.5 atomic transaction fix prevents
 * for new writes, but which may exist in data written before the fix).
 *
 * For every orphan found, a fresh syncQueue entry is reconstructed from the
 * record's own fields so Phase 3B can sync it normally.
 */

import { localDb, type SyncQueueEntry } from "./local-db";
import { syncEngine } from "./sync-engine";

export async function runRecovery(): Promise<void> {
  try {
    await Promise.all([
      recoverOrphanedCustomers(),
      recoverOrphanedOrders(),
      recoverOrphanedStatusUpdates(),
      recoverOrphanedPayments(),
      recoverOrphanedPickups(),
    ]);
  } catch (err) {
    console.error("[CleanTrack Recovery] Unexpected error during startup recovery:", err);
  }
}

async function recoverOrphanedCustomers(): Promise<void> {
  const pendingCustomers = await localDb.customers
    .where("syncStatus")
    .equals("pending_create")
    .toArray();

  if (pendingCustomers.length === 0) return;

  const existingQueueEntries = await localDb.syncQueue
    .where("operation")
    .equals("create_customer")
    .toArray();

  const queuedLocalIds = new Set(existingQueueEntries.map(e => e.localId));
  const orphans = pendingCustomers.filter(c => !queuedLocalIds.has(c.localId));

  if (orphans.length === 0) return;

  console.warn(
    `[CleanTrack Recovery] ${orphans.length} orphaned pending customer(s) — rebuilding queue entries`
  );

  const now = new Date().toISOString();
  for (const customer of orphans) {
    const entry: SyncQueueEntry = {
      clientId: crypto.randomUUID(),
      position: Date.now(),
      operation: "create_customer",
      payload: {
        fullName: customer.fullName,
        phone: customer.phone,
        address: customer.address ?? null,
        notes: customer.notes ?? null,
        branchId: customer.branchId ?? null,
        laundryId: customer.laundryId,
      },
      localId: customer.localId,
      dependsOn: [],
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: now,
    };
    await localDb.syncQueue.add(entry);
  }

  await syncEngine.notifyQueueChanged();
}

async function recoverOrphanedStatusUpdates(): Promise<void> {
  const pendingStatusOrders = await localDb.orders
    .where("syncStatus")
    .equals("pending_status_update")
    .toArray();

  if (pendingStatusOrders.length === 0) return;

  const existingQueueEntries = await localDb.syncQueue
    .where("operation")
    .equals("update_order_status")
    .toArray();

  const queuedLocalIds = new Set(existingQueueEntries.map(e => e.localId));
  const orphans = pendingStatusOrders.filter(o => !queuedLocalIds.has(o.localId));

  if (orphans.length === 0) return;

  console.warn(
    `[CleanTrack Recovery] ${orphans.length} orphaned pending-status-update order(s) — rebuilding queue entries`
  );

  const now = new Date().toISOString();
  for (const order of orphans) {
    const entry: SyncQueueEntry = {
      clientId: crypto.randomUUID(),
      position: Date.now(),
      operation: "update_order_status",
      payload: {
        localId: order.localId,
        serverId: order.serverId ?? null,
        changes: { status: order.status },
        timestamp: now,
      },
      localId: order.localId,
      dependsOn: [],
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: now,
    };
    await localDb.syncQueue.add(entry);
  }

  await syncEngine.notifyQueueChanged();
}

async function recoverOrphanedPayments(): Promise<void> {
  const pendingPayments = await localDb.payments
    .where("syncStatus")
    .equals("pending_create")
    .toArray();

  if (pendingPayments.length === 0) return;

  const existingQueueEntries = await localDb.syncQueue
    .where("operation")
    .equals("record_payment")
    .toArray();

  const queuedLocalIds = new Set(existingQueueEntries.map((e) => e.localId));
  const orphans = pendingPayments.filter((p) => !queuedLocalIds.has(p.localId));

  if (orphans.length === 0) return;

  console.warn(
    `[CleanTrack Recovery] ${orphans.length} orphaned pending payment(s) — rebuilding queue entries`
  );

  const now = new Date().toISOString();
  for (const payment of orphans) {
    const dependsOn: string[] =
      payment.orderId === null ? [payment.orderLocalId] : [];

    const entry: SyncQueueEntry = {
      clientId: crypto.randomUUID(),
      position: Date.now(),
      operation: "record_payment",
      payload: {
        orderLocalId: payment.orderLocalId,
        serverId: payment.orderId,
        amount: payment.amount,
        method: payment.method,
        notes: payment.notes ?? null,
        laundryId: payment.laundryId,
        branchId: payment.branchId ?? null,
        timestamp: payment.createdAt,
      },
      localId: payment.localId,
      dependsOn,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: now,
    };
    await localDb.syncQueue.add(entry);
  }

  await syncEngine.notifyQueueChanged();
}

async function recoverOrphanedOrders(): Promise<void> {
  const pendingOrders = await localDb.orders
    .where("syncStatus")
    .equals("pending_create")
    .toArray();

  if (pendingOrders.length === 0) return;

  const existingQueueEntries = await localDb.syncQueue
    .where("operation")
    .equals("create_order")
    .toArray();

  const queuedLocalIds = new Set(existingQueueEntries.map(e => e.localId));
  const orphans = pendingOrders.filter(o => !queuedLocalIds.has(o.localId));

  if (orphans.length === 0) return;

  console.warn(
    `[CleanTrack Recovery] ${orphans.length} orphaned pending order(s) — rebuilding queue entries`
  );

  const now = new Date().toISOString();
  for (const order of orphans) {
    const items = await localDb.orderItems
      .where("orderLocalId")
      .equals(order.localId)
      .toArray();

    const dependsOn: string[] = order.customerLocalId
      ? [order.customerLocalId]
      : [];

    const entry: SyncQueueEntry = {
      clientId: crypto.randomUUID(),
      position: Date.now(),
      operation: "create_order",
      payload: {
        customerName: order.customerName,
        phone: order.phone,
        address: order.address ?? null,
        customerId: order.customerId ?? null,
        customerLocalId: order.customerLocalId ?? null,
        serviceType: order.serviceType,
        items: items.map(i => ({ serviceId: i.serviceId, quantity: i.quantity })),
        additionalNotes: order.additionalNotes ?? null,
        discount: order.discount ?? null,
        extraCharge: order.extraCharge ?? null,
        branchId: order.branchId ?? null,
        laundryId: order.laundryId,
      },
      localId: order.localId,
      dependsOn,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: now,
    };
    await localDb.syncQueue.add(entry);
  }

  await syncEngine.notifyQueueChanged();
}

/**
 * Finds LocalPickup records that are stuck in "pending_create" but have no
 * corresponding syncQueue entry (e.g. the app crashed between the Dexie
 * transaction completing and the queue-processing loop being scheduled).
 *
 * Recovery: re-inserts a record_pickup queue entry with dependsOn recomputed
 * from any still-pending create_order or record_payment entries for the same
 * order.
 */
async function recoverOrphanedPickups(): Promise<void> {
  const pendingPickups = await localDb.pickups
    .where("syncStatus")
    .equals("pending_create")
    .toArray();

  if (pendingPickups.length === 0) return;

  const queuedLocalIds = new Set(
    (
      await localDb.syncQueue
        .where("operation")
        .equals("record_pickup")
        .filter((e) => e.status !== "done" && e.status !== "failed")
        .toArray()
    ).map((e) => e.localId)
  );

  const orphans = pendingPickups.filter((p) => !queuedLocalIds.has(p.localId));

  if (orphans.length === 0) return;

  console.warn(
    `[CleanTrack Recovery] ${orphans.length} orphaned pending pickup(s) — rebuilding queue entries`
  );

  const now = new Date().toISOString();

  for (const pickup of orphans) {
    const orderLocalId = pickup.orderLocalId;
    const dependsOn: string[] = [];
    const isOfflineOrder =
      pickup.orderId === null && !orderLocalId.startsWith("srv-");

    if (isOfflineOrder) {
      dependsOn.push(orderLocalId);

      const pendingPaymentEntries = await localDb.syncQueue
        .where("status")
        .anyOf(["pending", "in_flight"])
        .filter(
          (e) =>
            e.operation === "record_payment" &&
            (e.payload as Record<string, unknown>)["orderLocalId"] ===
              orderLocalId
        )
        .toArray();

      for (const e of pendingPaymentEntries) {
        if (!dependsOn.includes(e.localId)) dependsOn.push(e.localId);
      }
    }

    const serverId =
      pickup.orderId ??
      (orderLocalId.startsWith("srv-")
        ? parseInt(orderLocalId.slice(4), 10) || null
        : null);

    const recoveryEntry: SyncQueueEntry = {
      clientId: crypto.randomUUID(),
      position: Date.now(),
      operation: "record_pickup",
      payload: {
        orderLocalId,
        serverId,
        items: pickup.items
          ? pickup.items
              .map((i) => {
                const id = parseInt(i.orderItemLocalId, 10);
                // Guard: skip items whose stored ID is non-numeric or zero —
                // sending orderItemId=0 would cause the server to reject the
                // entire request with a 400.
                if (!Number.isFinite(id) || id <= 0) {
                  console.warn(
                    `[CleanTrack Recovery] Pickup ${pickup.localId}: skipping item ` +
                      `"${i.name}" — stored orderItemLocalId "${i.orderItemLocalId}" ` +
                      `is not a valid server item ID`
                  );
                  return null;
                }
                return { orderItemId: id, quantity: i.quantity, name: i.name };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null)
          : null,
        shirtsPickedUp: pickup.shirtsPickedUp,
        trousersPickedUp: pickup.trousersPickedUp,
        notes: pickup.notes ?? null,
        laundryId: pickup.laundryId,
        timestamp: pickup.createdAt,
      },
      localId: pickup.localId,
      dependsOn,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: now,
    };

    await localDb.syncQueue.add(recoveryEntry);
  }

  await syncEngine.notifyQueueChanged();
}
