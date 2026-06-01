import type { Persister, PersistedClient } from "@tanstack/react-query-persist-client";
import { localDb } from "./local-db";

const CACHE_KEY = "rq_persist_cache_v1";

/**
 * Phase 2: IndexedDB persister for React Query.
 *
 * Serializes the entire React Query client state into a single
 * metadata entry in the Dexie DB. On startup the app hydrates from
 * this snapshot before any network request fires, making all cached
 * queries (orders, customers, services, branches, receipts) available
 * immediately — including when the device is offline.
 */
export const idbPersister: Persister = {
  persistClient: async (client: PersistedClient): Promise<void> => {
    try {
      await localDb.metadata.put({ key: CACHE_KEY, value: JSON.stringify(client) });
    } catch (e) {
      console.warn("[CleanTrack] Failed to persist query cache:", e);
    }
  },

  restoreClient: async (): Promise<PersistedClient | undefined> => {
    try {
      const entry = await localDb.metadata.get(CACHE_KEY);
      if (!entry?.value) return undefined;
      return JSON.parse(String(entry.value)) as PersistedClient;
    } catch (e) {
      console.warn("[CleanTrack] Failed to restore query cache:", e);
      return undefined;
    }
  },

  removeClient: async (): Promise<void> => {
    try {
      await localDb.metadata.delete(CACHE_KEY);
    } catch {
      // ignore
    }
  },
};
