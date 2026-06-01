/**
 * SyncEngine — Phase 1 Skeleton
 *
 * This module defines the full structure and public API of the sync engine.
 * No synchronization logic is implemented in Phase 1 — all methods are stubs.
 *
 * Phase 2: Implement read caching (pull-down sync, React Query persistence)
 * Phase 3: Implement write queue (enqueue, processQueue, patch-back server IDs)
 * Phase 4: Implement conflict detection (payment/pickup conflict guards)
 */

import { localDb, type SyncOperation, type SyncQueueEntry } from "./local-db";

export type SyncStatus = "idle" | "syncing" | "offline" | "error" | "paused";

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  failedCount: number;
  lastSyncedAt: Date | null;
  currentOperation: string | null;
  isOnline: boolean;
}

export type SyncEventType =
  | "status_change"
  | "item_synced"
  | "item_failed"
  | "conflict_detected"
  | "queue_empty"
  | "offline"
  | "online";

export interface SyncEvent {
  type: SyncEventType;
  payload?: unknown;
}

type SyncEventListener = (event: SyncEvent) => void;

const DEFAULT_STATE: SyncState = {
  status: "idle",
  pendingCount: 0,
  failedCount: 0,
  lastSyncedAt: null,
  currentOperation: null,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
};

class SyncEngine {
  private state: SyncState = { ...DEFAULT_STATE };
  private listeners: Set<SyncEventListener> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  private readonly POLL_INTERVAL_MS = 30_000;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);

    this.updateState({ isOnline: navigator.onLine });

    this.pollTimer = setInterval(() => {
      this.tick();
    }, this.POLL_INTERVAL_MS);

    this.refreshCounts();
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getState(): Readonly<SyncState> {
    return { ...this.state };
  }

  subscribe(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Phase 3: Add a write operation to the sync queue.
   * @param operation — type of operation (e.g. "create_order")
   * @param localId — the local UUID of the record being created/updated
   * @param payload — full request body for the server
   * @param dependsOn — localIds that must sync successfully before this entry
   */
  async enqueue(
    operation: SyncOperation,
    localId: string,
    payload: Record<string, unknown>,
    dependsOn: string[] = []
  ): Promise<void> {
    // TODO Phase 3: implement enqueue logic
    const entry: SyncQueueEntry = {
      clientId: crypto.randomUUID(),
      position: Date.now(),
      operation,
      payload,
      localId,
      dependsOn,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await localDb.syncQueue.add(entry);
    await this.refreshCounts();
    this.emit({ type: "status_change" });
  }

  /**
   * Phase 3: Manually trigger a sync attempt (also called on reconnect).
   */
  async sync(): Promise<void> {
    // TODO Phase 3: implement sync logic
    if (!navigator.onLine) return;
    await this.refreshCounts();
  }

  /**
   * Phase 3: Process the next batch of pending queue entries.
   * Handles dependency ordering, retries, and server-ID patch-back.
   */
  private async processQueue(): Promise<void> {
    // TODO Phase 3: implement queue processing
    // 1. Fetch pending entries ordered by position
    // 2. Check dependsOn entries are all "done"
    // 3. Call the correct API endpoint for each entry
    // 4. On success: update local record serverId, mark entry "done", write syncLog
    // 5. On failure: increment attempts, apply exponential backoff, mark "failed" after max retries
  }

  /**
   * Phase 2: Pull fresh data from the server and merge into IndexedDB.
   * Uses delta sync (since last pull timestamp) to minimise data transfer.
   */
  private async pullFromServer(): Promise<void> {
    // TODO Phase 2: implement pull-down sync
    // 1. Read metadata.last_orders_sync, metadata.last_customers_sync
    // 2. Fetch GET /api/orders?since=timestamp&branchId=active
    // 3. Fetch GET /api/customers?since=timestamp&branchId=active
    // 4. Merge into localDb.orders and localDb.customers (server wins for synced records)
    // 5. Update metadata timestamps
  }

  pause(): void {
    this.updateState({ status: "paused" });
  }

  resume(): void {
    if (this.state.status === "paused") {
      this.updateState({ status: "idle" });
      this.tick();
    }
  }

  /**
   * Called by queue-service after completing an atomic dual-write so the
   * engine's in-memory pendingCount stays in sync without the engine needing
   * to own the DB writes itself.
   */
  async notifyQueueChanged(): Promise<void> {
    await this.refreshCounts();
  }

  async getPendingCount(): Promise<number> {
    return localDb.syncQueue
      .where("status")
      .equals("pending")
      .count();
  }

  async getFailedCount(): Promise<number> {
    return localDb.syncQueue
      .where("status")
      .equals("failed")
      .count();
  }

  async getPendingEntries(): Promise<SyncQueueEntry[]> {
    return localDb.syncQueue
      .where("status")
      .anyOf(["pending", "in_flight", "failed"])
      .sortBy("position");
  }

  private async tick(): Promise<void> {
    if (!navigator.onLine || this.state.status === "paused") return;
    await this.refreshCounts();
    if (this.state.pendingCount > 0) {
      await this.processQueue();
    }
  }

  private async refreshCounts(): Promise<void> {
    const [pendingCount, failedCount] = await Promise.all([
      this.getPendingCount(),
      this.getFailedCount(),
    ]);
    this.updateState({ pendingCount, failedCount });
  }

  private handleOnline = (): void => {
    this.updateState({ isOnline: true, status: "idle" });
    this.emit({ type: "online" });
    this.tick();
  };

  private handleOffline = (): void => {
    this.updateState({ isOnline: false, status: "offline" });
    this.emit({ type: "offline" });
  };

  private updateState(partial: Partial<SyncState>): void {
    const prev = this.state;
    this.state = { ...this.state, ...partial };
    if (
      prev.status !== this.state.status ||
      prev.pendingCount !== this.state.pendingCount ||
      prev.failedCount !== this.state.failedCount ||
      prev.isOnline !== this.state.isOnline
    ) {
      this.emit({ type: "status_change", payload: this.state });
    }
  }

  private emit(event: SyncEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // never let a bad listener crash the engine
      }
    });
  }
}

export const syncEngine = new SyncEngine();
