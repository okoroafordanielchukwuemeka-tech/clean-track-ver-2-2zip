/**
 * Polling hooks for pending-sync local records.
 *
 * These hooks read directly from the Dexie IndexedDB tables every 2 seconds
 * so that any component can react to locally-saved offline records without
 * going through React Query (which only tracks server-fetched data).
 *
 * Once Phase 3B sync is implemented these hooks will return empty arrays for
 * records that have been successfully synced (syncStatus === "synced").
 */

import { useState, useEffect } from "react";
import { localDb, type LocalCustomer, type LocalOrder, type LocalPayment, type LocalPickup } from "@/lib/local-db";

const POLL_INTERVAL_MS = 2_000;

/**
 * Returns all LocalCustomer records with syncStatus === "pending_create"
 * belonging to the given laundryId. Re-reads IndexedDB every 2 s.
 */
export function usePendingLocalCustomers(laundryId: number | null): LocalCustomer[] {
  const [pending, setPending] = useState<LocalCustomer[]>([]);

  useEffect(() => {
    if (!laundryId) {
      setPending([]);
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        const records = await localDb.customers
          .where("syncStatus")
          .equals("pending_create")
          .filter(c => c.laundryId === laundryId)
          .toArray();
        if (active) setPending(records);
      } catch {
        // Dexie may throw if the DB is not yet ready; ignore silently
      }
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [laundryId]);

  return pending;
}

/**
 * Returns all LocalOrder records with syncStatus === "pending_create"
 * belonging to the given laundryId. Re-reads IndexedDB every 2 s.
 */
export function usePendingLocalOrders(laundryId: number | null): LocalOrder[] {
  const [pending, setPending] = useState<LocalOrder[]>([]);

  useEffect(() => {
    if (!laundryId) {
      setPending([]);
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        const records = await localDb.orders
          .where("syncStatus")
          .equals("pending_create")
          .filter(o => o.laundryId === laundryId)
          .toArray();
        if (active) setPending(records);
      } catch {
        // ignore
      }
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [laundryId]);

  return pending;
}

/**
 * Returns all LocalPayment records with syncStatus === "pending_create"
 * for the given orderLocalId (e.g. "srv-<serverId>"). Re-reads IndexedDB every 2 s.
 *
 * Used in order-detail to show payments queued while offline before they sync.
 */
export function usePendingLocalPayments(orderLocalId: string | null): LocalPayment[] {
  const [pending, setPending] = useState<LocalPayment[]>([]);

  useEffect(() => {
    if (!orderLocalId) {
      setPending([]);
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        const records = await localDb.payments
          .where("syncStatus")
          .equals("pending_create")
          .filter((p) => p.orderLocalId === orderLocalId)
          .toArray();
        if (active) setPending(records);
      } catch {
        // ignore
      }
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [orderLocalId]);

  return pending;
}

/**
 * Returns all LocalPickup records with syncStatus === "pending_create"
 * for the given orderLocalId (e.g. "srv-<serverId>"). Re-reads IndexedDB every 2 s.
 *
 * Used in order-detail to show pickups queued while offline before they sync.
 */
export function usePendingLocalPickups(orderLocalId: string | null): LocalPickup[] {
  const [pending, setPending] = useState<LocalPickup[]>([]);

  useEffect(() => {
    if (!orderLocalId) {
      setPending([]);
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        const records = await localDb.pickups
          .where("syncStatus")
          .equals("pending_create")
          .filter((p) => p.orderLocalId === orderLocalId)
          .toArray();
        if (active) setPending(records);
      } catch {
        // ignore
      }
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [orderLocalId]);

  return pending;
}

/**
 * Returns all LocalPayment records with syncStatus === "conflict"
 * for the given orderLocalId (e.g. "srv-<serverId>"). Re-reads IndexedDB every 2 s.
 *
 * Used in order-detail to show payments that permanently failed with a
 * financial conflict (ORDER_ALREADY_PAID, OVERPAYMENT_ATTEMPT, etc.)
 * so the user can review and resolve them manually.
 */
export function useConflictLocalPayments(orderLocalId: string | null): LocalPayment[] {
  const [conflicts, setConflicts] = useState<LocalPayment[]>([]);

  useEffect(() => {
    if (!orderLocalId) {
      setConflicts([]);
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        const records = await localDb.payments
          .where("syncStatus")
          .equals("conflict")
          .filter((p) => p.orderLocalId === orderLocalId)
          .toArray();
        if (active) setConflicts(records);
      } catch {
        // ignore
      }
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [orderLocalId]);

  return conflicts;
}

/**
 * Returns all LocalPickup records with syncStatus === "conflict"
 * for the given orderLocalId (e.g. "srv-<serverId>"). Re-reads IndexedDB every 2 s.
 *
 * Used in order-detail to surface pickups that permanently failed with a
 * quantity mismatch or invalid order status so the worker can take manual
 * action (e.g. re-record after refresh).
 */
export function useConflictLocalPickups(orderLocalId: string | null): LocalPickup[] {
  const [conflicts, setConflicts] = useState<LocalPickup[]>([]);

  useEffect(() => {
    if (!orderLocalId) {
      setConflicts([]);
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        const records = await localDb.pickups
          .where("syncStatus")
          .equals("conflict")
          .filter((p) => p.orderLocalId === orderLocalId)
          .toArray();
        if (active) setConflicts(records);
      } catch {
        // ignore
      }
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [orderLocalId]);

  return conflicts;
}

/**
 * Returns all sync queue entries with status === "failed".
 *
 * These entries have exhausted their retry budget (or received an immediate
 * permanent failure like a 4xx or conflict) and will not be retried
 * automatically.  The UI uses this hook to surface a "Failed Sync" panel
 * so users can inspect errors and trigger a manual retry.
 *
 * Re-reads IndexedDB every 2 s so the panel disappears once all failed
 * entries have been successfully requeued and synced.
 *
 * No laundryId filter: the caller receives all failed entries across all
 * operations so nothing is silently hidden from the operator.
 */
export function useFailedSyncEntries() {
  const [failed, setFailed] = useState<import("@/lib/local-db").SyncQueueEntry[]>([]);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const records = await localDb.syncQueue
          .where("status")
          .equals("failed")
          .toArray();
        if (active) setFailed(records);
      } catch {
        // Dexie may throw if the DB is not yet open; ignore silently
      }
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return failed;
}

/**
 * Returns all sync queue entries for the given order's localId that:
 *   - operation === "update_order_status"
 *   - status === "failed"
 *   - lastError starts with "CONFLICT:STATUS_TRANSITION:"
 *
 * Used in order-detail to surface a ConflictSyncBadge when an offline
 * status update was permanently rejected by the server's state machine
 * (e.g. completed → pending attempted while offline).
 *
 * Re-reads IndexedDB every 2 s.
 */
export function useConflictStatusSyncEntries(
  orderLocalId: string | null
): import("@/lib/local-db").SyncQueueEntry[] {
  const [conflicts, setConflicts] = useState<import("@/lib/local-db").SyncQueueEntry[]>([]);

  useEffect(() => {
    if (!orderLocalId) {
      setConflicts([]);
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        const records = await localDb.syncQueue
          .where("status")
          .equals("failed")
          .filter(
            (e) =>
              e.operation === "update_order_status" &&
              e.localId === orderLocalId &&
              typeof e.lastError === "string" &&
              e.lastError.startsWith("CONFLICT:STATUS_TRANSITION:")
          )
          .toArray();
        if (active) setConflicts(records);
      } catch {
        // ignore
      }
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [orderLocalId]);

  return conflicts;
}

/**
 * Returns all LocalOrder records with syncStatus === "pending_status_update"
 * belonging to the given laundryId. Re-reads IndexedDB every 2 s.
 */
export function usePendingStatusUpdateOrders(laundryId: number | null): LocalOrder[] {
  const [pending, setPending] = useState<LocalOrder[]>([]);

  useEffect(() => {
    if (!laundryId) {
      setPending([]);
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        const records = await localDb.orders
          .where("syncStatus")
          .equals("pending_status_update")
          .filter(o => o.laundryId === laundryId)
          .toArray();
        if (active) setPending(records);
      } catch {
        // ignore
      }
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [laundryId]);

  return pending;
}
