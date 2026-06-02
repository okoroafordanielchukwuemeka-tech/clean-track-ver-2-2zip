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
import { localDb, type LocalCustomer, type LocalOrder } from "@/lib/local-db";

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
