/**
 * SyncEngine — Phase 3B
 *
 * Manages the lifecycle of the background sync process:
 *  - Starts/stops the 30-second poll timer
 *  - Listens to online/offline browser events
 *  - Delegates actual queue processing to queue-service.processQueue()
 *  - Exposes state (pendingCount, failedCount, status) via subscribe()
 *
 * Phase 3B implements:
 *   processQueue()  → delegates to queue-service (customers first, orders second)
 *   sync()          → public trigger (used on reconnect and manual retry)
 *
 * Phase 4: Implement conflict detection (payment/pickup conflict guards)
 */

import { localDb, type SyncOperation, type SyncQueueEntry } from "./local-db";
import { processQueue as processQueueFromService } from "./queue-service";

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
  private isSyncing = false;

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
   * Add a write operation to the sync queue.
   * Prefer enqueueCustomerCreate() / enqueueOrderCreate() from queue-service
   * for the atomic dual-write guarantee. This method is kept for other
   * operation types (update_order_status, etc.) that do not need it.
   */
  async enqueue(
    operation: SyncOperation,
    localId: string,
    payload: Record<string, unknown>,
    dependsOn: string[] = []
  ): Promise<void> {
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
   * Manually trigger a sync attempt.
   * Called on reconnect, on manual "Retry" actions, and after enqueue.
   * No-ops if offline, paused, or already syncing.
   */
  async sync(): Promise<void> {
    if (!navigator.onLine) return;
    if (this.state.status === "paused") return;
    if (this.isSyncing) return;
    await this.tick();
  }

  /**
   * Processes the pending queue by delegating to queue-service.processQueue().
   *
   * Sync ordering is enforced inside queue-service:
   *  1. create_customer entries are processed first (no dependsOn)
   *  2. create_order entries are only processed once all their dependsOn
   *     localIds are "done"
   *
   * State transitions:
   *  idle → syncing → idle (on completion)
   *  idle → syncing → error (if processQueue throws)
   */
  private async processQueue(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.updateState({ status: "syncing", currentOperation: "processing queue" });

    try {
      await processQueueFromService();

      const [pendingCount, failedCount] = await Promise.all([
        this.getPendingCount(),
        this.getFailedCount(),
      ]);

      if (pendingCount === 0 && failedCount === 0) {
        this.emit({ type: "queue_empty" });
      }

      this.updateState({
        status: "idle",
        currentOperation: null,
        lastSyncedAt: new Date(),
      });
    } catch (err) {
      console.error("[CleanTrack SyncEngine] processQueue threw unexpectedly:", err);
      this.updateState({ status: "error", currentOperation: null });
    } finally {
      this.isSyncing = false;
      await this.refreshCounts();
    }
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
    // Trigger a sync attempt immediately when a new item is enqueued.
    if (navigator.onLine && this.state.status !== "paused") {
      this.sync();
    }
  }

  /**
   * Called by syncPaymentEntry after a payment successfully syncs to the
   * server.  Emits an item_synced event so subscribers (e.g. order-detail)
   * can invalidate their React Query caches and reflect the real server
   * state — updated amountPaid, paymentStatus, and payment list.
   *
   * @param serverOrderId  The numeric server-side order ID (never null here
   *   because syncPaymentEntry only calls this on success after resolving it).
   * @param localId  The payment's local UUID, for precise cache targeting.
   */
  notifyPaymentSynced(serverOrderId: number, localId: string): void {
    this.emit({
      type: "item_synced",
      payload: { operation: "record_payment", serverOrderId, localId },
    });
  }

  /**
   * Called by syncPickupEntry after a pickup successfully syncs to the server.
   * Emits an item_synced event so order-detail can invalidate its React Query
   * caches — refreshing the order status, item quantities, and pickup list —
   * without waiting for the next window-focus refetch.
   *
   * @param serverOrderId  The numeric server-side order ID.
   * @param localId        The pickup's local UUID.
   */
  notifyPickupSynced(serverOrderId: number, localId: string): void {
    this.emit({
      type: "item_synced",
      payload: { operation: "record_pickup", serverOrderId, localId },
    });
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
