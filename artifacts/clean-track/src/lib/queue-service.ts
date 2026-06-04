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
  return Math.min(Math.pow(2, attempts) * 1_000, MAX_BACKOFF_MS);
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

// ── Financial conflict types ───────────────────────────────────────────────

/**
 * The four categories of payment conflict that can never be resolved by
 * retrying.  Each maps to a specific pre-sync validation check.
 *
 *  ORDER_ALREADY_PAID    — order.amountPaid >= totalDue at sync time
 *  PAYMENT_CONFLICT      — amount ≤ 0 or other structural payment invalidity
 *  OVERPAYMENT_ATTEMPT   — payment.amount > remaining balance
 *  DUPLICATE_PAYMENT     — server returned 409 (idempotency hit on a different key)
 */
export type ConflictCode =
  | "ORDER_ALREADY_PAID"
  | "PAYMENT_CONFLICT"
  | "OVERPAYMENT_ATTEMPT"
  | "DUPLICATE_PAYMENT";

/**
 * Thrown by validatePaymentPreSync() when a payment cannot safely proceed.
 *
 * These errors are always permanent failures:
 *  - queue entry  → status = "failed"  (no retry)
 *  - local record → syncStatus = "conflict"  (flagged for manual review)
 *  - syncLog      → error prefixed with "CONFLICT:<code>:"
 */
export class FinancialConflictError extends Error {
  constructor(
    public readonly code: ConflictCode,
    message: string
  ) {
    super(message);
    this.name = "FinancialConflictError";
  }
}

/**
 * Returns true when an HttpError is a payment-specific financial conflict
 * that must never be retried (409 Conflict, or a 400 whose message contains
 * payment-domain keywords).
 */
function isFinancialConflictHttpError(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  if (err.status === 409) return true;
  if (err.status !== 400) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("paid") ||
    msg.includes("conflict") ||
    msg.includes("duplicate") ||
    msg.includes("overpay")
  );
}

/**
 * Pre-sync payment validation layer.
 *
 * Must be called before every network call in syncPaymentEntry.
 * Performs all checks that can be resolved without hitting the payment
 * endpoint, so we never waste a server round-trip on bad data.
 *
 * Validation steps (in order):
 *  1. amount > 0                     → PAYMENT_CONFLICT
 *  2. serverOrderId exists           → plain Error (transient — retried with backoff)
 *  3. GET current order state        → plain Error if fetch fails (transient)
 *  4. Order not already fully paid   → ORDER_ALREADY_PAID (permanent)
 *  5. Amount ≤ remaining balance     → OVERPAYMENT_ATTEMPT (permanent)
 *
 * FinancialConflictError → permanent failure, no retry.
 * Plain Error            → transient, will be retried with exponential backoff.
 */
export async function validatePaymentPreSync(
  p: OfflinePaymentPayload,
  serverOrderId: number
): Promise<void> {
  // 1. Structural amount check
  if (p.amount <= 0) {
    throw new FinancialConflictError(
      "PAYMENT_CONFLICT",
      `Payment amount ₦${p.amount} is invalid — must be greater than zero`
    );
  }

  // 2. Fetch live order state to check payment capacity
  //    Throws a plain network Error on failure → treated as transient by the caller
  const order = await api.orders.get(serverOrderId);

  // 3. Compute financials from server values
  //    Use parseFloat(String()) to safely handle both number and string DB returns.
  const price = parseFloat(String(order.price ?? 0));
  const extraCharge = parseFloat(String(order.extraCharge ?? 0));
  const discount = parseFloat(String(order.discount ?? 0));
  const totalDue = price + extraCharge - discount;
  const alreadyPaid = parseFloat(String(order.amountPaid ?? 0));
  const remaining = Math.max(0, totalDue - alreadyPaid);

  // 4. Already fully paid?
  if (totalDue > 0 && alreadyPaid >= totalDue - 0.01) {
    throw new FinancialConflictError(
      "ORDER_ALREADY_PAID",
      `Order ${serverOrderId} is already fully paid ` +
        `(totalDue=₦${totalDue.toFixed(2)}, alreadyPaid=₦${alreadyPaid.toFixed(2)})`
    );
  }

  // 5. Overpayment?  +0.01 tolerance for floating-point rounding edge cases.
  if (totalDue > 0 && p.amount > remaining + 0.01) {
    throw new FinancialConflictError(
      "OVERPAYMENT_ATTEMPT",
      `Payment ₦${p.amount} exceeds remaining balance ₦${remaining.toFixed(2)} ` +
        `for order ${serverOrderId} (totalDue=₦${totalDue.toFixed(2)}, alreadyPaid=₦${alreadyPaid.toFixed(2)})`
    );
  }
}

// ── Pickup conflict types ──────────────────────────────────────────────────

/**
 * Pickup conflict codes — permanent failures that must not be retried.
 *
 *  INVALID_ORDER_STATUS — order is not "ready" or "partial_pickup" at sync time
 *  QUANTITY_EXCEEDED    — requested pickup qty exceeds server-side remaining qty
 *  ORDER_NOT_FOUND      — server returned 404 for the order
 */
export type ConflictPickupCode =
  | "INVALID_ORDER_STATUS"
  | "QUANTITY_EXCEEDED"
  | "ORDER_NOT_FOUND";

/**
 * Thrown by validatePickupPreSync() when a pickup cannot safely proceed.
 * Treated as a permanent failure: sets syncStatus="conflict" on the local
 * record, marks queue entry "failed", and prefixes the syncLog entry with
 * "CONFLICT:<code>:" for diagnostics.
 */
export class PickupConflictError extends Error {
  constructor(
    public readonly code: ConflictPickupCode,
    message: string
  ) {
    super(message);
    this.name = "PickupConflictError";
  }
}

// ── Status transition conflict types ──────────────────────────────────────

/**
 * Thrown when the server rejects an offline status update with HTTP 409
 * because the transition violates the state machine
 * (e.g. completed → pending, pending → completed, ready → processing).
 *
 * Treated as a permanent failure: marks queue entry "failed" and prefixes
 * the syncLog entry with "CONFLICT:STATUS_TRANSITION:" for diagnostics.
 */
export class StatusTransitionConflictError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
    message: string
  ) {
    super(message);
    this.name = "StatusTransitionConflictError";
  }
}

/**
 * Returns true when an HttpError is a status-transition conflict (HTTP 409
 * whose body carries code === "INVALID_STATUS_TRANSITION").
 */
function isStatusTransitionConflictHttpError(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  if (err.status !== 409) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("invalid_status_transition") || msg.includes("cannot move order");
}

/**
 * Pre-sync pickup validation layer.
 *
 * Must be called before every network call in syncPickupEntry so we never
 * waste a server round-trip on data that is guaranteed to be rejected.
 *
 * Validation steps (in order):
 *  1. GET current order state from server            → ORDER_NOT_FOUND if 404
 *  2. Order status is "ready" or "partial_pickup"   → INVALID_ORDER_STATUS
 *  3. For item-based pickups: each item qty ≤ remaining on server
 *                                                    → QUANTITY_EXCEEDED
 *  4. For legacy pickups: shirts+trousers > 0        → plain Error (structural)
 *
 * PickupConflictError → permanent failure, no retry.
 * Plain Error         → transient, retried with exponential backoff.
 */
export async function validatePickupPreSync(
  p: OfflinePickupPayload,
  serverOrderId: number
): Promise<void> {
  // 1. Fetch live order state
  let order: Awaited<ReturnType<typeof api.orders.get>>;
  try {
    order = await api.orders.get(serverOrderId);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new PickupConflictError(
        "ORDER_NOT_FOUND",
        `Order ${serverOrderId} not found on server — cannot sync pickup`
      );
    }
    throw err; // transient network error — will be retried
  }

  // 2. Order status check
  if (order.status !== "ready" && order.status !== "partial_pickup") {
    throw new PickupConflictError(
      "INVALID_ORDER_STATUS",
      `Order ${serverOrderId} has status "${order.status}" — pickup requires "ready" or "partial_pickup"`
    );
  }

  // 3. Item-based quantity check
  if (p.items && p.items.length > 0) {
    const serverItems: Array<{ id: number; quantity: number; quantityPickedUp: number; name: string }> =
      (order as any).items ?? [];
    for (const req of p.items) {
      const serverItem = serverItems.find((i) => i.id === req.orderItemId);
      if (!serverItem) continue; // server will reject — let it; don't block here
      const remaining = serverItem.quantity - serverItem.quantityPickedUp;
      if (req.quantity > remaining) {
        throw new PickupConflictError(
          "QUANTITY_EXCEEDED",
          `Item "${serverItem.name}" (id=${req.orderItemId}): requested ${req.quantity} ` +
            `but only ${remaining} remaining on order ${serverOrderId}`
        );
      }
    }
  }
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

/**
 * Maximum number of retry attempts for transient failures (network errors, 5xx).
 *
 * With a 5-minute cap, the retry schedule looks like:
 *   attempt  1 →   2 s
 *   attempt  2 →   4 s
 *   attempt  3 →   8 s
 *   attempt  4 →  16 s
 *   attempt  5 →  32 s
 *   attempt  6 →  64 s
 *   attempt  7 → 128 s  (~2 min)
 *   attempt  8 → 300 s  (5 min cap)
 *   attempts 9–20 → 300 s each
 *
 * Total retry window before permanent failure: ~70 minutes.
 *
 * Entries are only retried when the device is online, so true offline
 * periods do not consume retry slots — workers can be offline for many
 * hours and still sync when they reconnect.
 *
 * Client errors (4xx non-transient) and conflict errors still fail
 * permanently on the first attempt — this limit only applies to
 * genuinely transient errors.
 */
const MAX_TRANSIENT_ATTEMPTS = 20;

/**
 * Maximum exponential back-off delay.
 * Extended from 60 s → 5 min so later attempts do not hammer a recovering server.
 */
const MAX_BACKOFF_MS = 300_000;

/**
 * Maximum number of queue entries to process in parallel within a single pass.
 *
 * 3 is intentionally conservative:
 *  - Avoids overwhelming the server with concurrent writes
 *  - Stays within IndexedDB's safe concurrent write range
 *  - Delivers ~3x throughput vs. fully sequential processing
 *  - Each slot may make 1-2 network calls (pre-check + write)
 *
 * Raise with caution — higher values risk server rate limits, IndexedDB write
 * contention, and idempotency key races under poor connectivity.
 */
const CONCURRENCY = 3;

/**
 * Retain syncLog entries for this many days, then prune.
 *
 * Without pruning, syncLog grows by ~3 rows per sync operation indefinitely.
 * At 2 syncs/hour and 20 retry attempts each, a busy device accumulates
 * ~200,000 rows after a month — causing noticeable IndexedDB slowdowns.
 *
 * Pruning is called at the end of every processQueue() cycle and is
 * best-effort (errors are swallowed so cleanup never affects syncing).
 */
const SYNC_LOG_TTL_DAYS = 7;

/**
 * Remove syncLog entries older than SYNC_LOG_TTL_DAYS.
 * Never throws — failure is silently ignored so pruning never affects syncing.
 */
async function pruneSyncLog(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - SYNC_LOG_TTL_DAYS * 86_400_000).toISOString();
    const oldKeys = await localDb.syncLog
      .where("syncedAt")
      .below(cutoff)
      .primaryKeys();
    if (oldKeys.length > 0) {
      await localDb.syncLog.bulkDelete(oldKeys as number[]);
      console.debug(`[CleanTrack Sync] Pruned ${oldKeys.length} old syncLog entries`);
    }
  } catch {
    // Best-effort only
  }
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
  }

  // Always depend on any pending payments for this order — whether the order
  // is offline-created or already on the server.  Without this, a server-synced
  // order with both a queued payment and a queued pickup could have the pickup
  // attempt before the payment settles if the payment enters backoff.
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
 *  3. If a customer sync fails after MAX_TRANSIENT_ATTEMPTS, dependent orders
 *     are skipped for this cycle (they remain pending until manually resolved).
 *
 * Concurrency:
 *  Each pass processes up to CONCURRENCY entries in parallel.  Within a pass
 *  items targeting different orders are independent, so CONCURRENCY=3 provides
 *  ~3x throughput vs. fully sequential processing without risking idempotency
 *  key races or server rate limits.  doneLocalIds is updated per-chunk so
 *  cross-chunk dependency resolution works correctly.
 *
 * Progress reporting:
 *  The optional onProgress callback is invoked after each concurrent chunk
 *  completes.  Enables the UI to show a live progress bar for large queues.
 *
 * In-flight recovery:
 *  Any entries still marked "in_flight" at the start of a cycle were left
 *  stranded by a previous crash.  They are reset to "pending" before processing.
 */
export async function processQueue(
  onProgress?: (done: number, total: number, phase: string) => void
): Promise<void> {
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
  //
  // OPTIMIZATION: Load only done entries whose localId appears in a pending
  // entry's dependsOn list — avoids a full-table scan of the "done" history
  // which grows unboundedly as entries accumulate across many sync cycles.
  // Without this, a device with 100,000+ historical done entries would load
  // all of them into RAM on every 30-second poll.
  const allDepsNeeded = new Set<string>();
  for (const e of pending) {
    for (const dep of e.dependsOn) allDepsNeeded.add(dep);
  }
  const doneLocalIds = new Set<string>();
  if (allDepsNeeded.size > 0) {
    const relevantDone = await localDb.syncQueue
      .where("status")
      .equals("done")
      .filter((e) => allDepsNeeded.has(e.localId))
      .toArray();
    for (const e of relevantDone) doneLocalIds.add(e.localId);
  }

  const total = pending.length;
  let processed = 0;

  // ── Pass 1: sync all pending customers ───────────────────────────────────
  // Customers have no dependsOn and must always be resolved before orders.
  const customerEntries = pending.filter(
    (e) => e.operation === "create_customer"
  );

  for (let i = 0; i < customerEntries.length; i += CONCURRENCY) {
    const chunk = customerEntries.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (entry) => {
        if (!isBackoffExpired(entry)) {
          console.debug(
            `[CleanTrack Sync] Customer ${entry.localId} in back-off (attempt ${entry.attempts}), skipping`
          );
          return null;
        }
        await syncCustomer(entry.localId);
        return entry.localId;
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value != null) doneLocalIds.add(r.value);
    }
    processed += chunk.length;
    onProgress?.(processed, total, "customers");
  }

  // ── Pass 2: sync pending orders whose dependencies are fully resolved ────
  const orderEntries = pending.filter((e) => e.operation === "create_order");

  for (let i = 0; i < orderEntries.length; i += CONCURRENCY) {
    const chunk = orderEntries.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (entry) => {
        const allDepsResolved = entry.dependsOn.every((dep) =>
          doneLocalIds.has(dep)
        );
        if (!allDepsResolved) {
          console.warn(
            `[CleanTrack Sync] Skipping order ${entry.localId} — unresolved dependencies: ` +
              entry.dependsOn.filter((d) => !doneLocalIds.has(d)).join(", ")
          );
          return null;
        }
        if (!isBackoffExpired(entry)) {
          console.debug(
            `[CleanTrack Sync] Order ${entry.localId} in back-off (attempt ${entry.attempts}), skipping`
          );
          return null;
        }
        await syncOrder(entry.localId);
        return entry.localId;
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value != null) doneLocalIds.add(r.value);
    }
    processed += chunk.length;
    onProgress?.(processed, total, "orders");
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

  for (let i = 0; i < dedupedStatusEntries.length; i += CONCURRENCY) {
    const chunk = dedupedStatusEntries.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (entry) => {
        const allDepsResolved = entry.dependsOn.every((dep) =>
          doneLocalIds.has(dep)
        );
        if (!allDepsResolved) {
          console.warn(
            `[CleanTrack Sync] Skipping status update for ${entry.localId} — unresolved dependencies: ` +
              entry.dependsOn.filter((d) => !doneLocalIds.has(d)).join(", ")
          );
          return null;
        }
        if (!isBackoffExpired(entry)) {
          console.debug(
            `[CleanTrack Sync] Status update ${entry.localId} in back-off ` +
              `(attempt ${entry.attempts}), skipping`
          );
          return null;
        }
        await syncOrderStatusEntry(entry);
        // Return localId so same-cycle pickup deps resolve correctly.
        return entry.localId;
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value != null) doneLocalIds.add(r.value);
    }
    processed += chunk.length;
    onProgress?.(processed, total, "status updates");
  }

  // ── Pass 4: sync pending payments ────────────────────────────────────────
  // Payments for offline-created orders depend on create_order completing first.
  // Payments for server-synced orders have no dependencies and go straight through.
  const paymentEntries = pending.filter(
    (e) => e.operation === "record_payment"
  );

  for (let i = 0; i < paymentEntries.length; i += CONCURRENCY) {
    const chunk = paymentEntries.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (entry) => {
        const allDepsResolved = entry.dependsOn.every((dep) =>
          doneLocalIds.has(dep)
        );
        if (!allDepsResolved) {
          console.warn(
            `[CleanTrack Sync] Skipping payment ${entry.localId} — unresolved dependencies: ` +
              entry.dependsOn.filter((d) => !doneLocalIds.has(d)).join(", ")
          );
          return null;
        }
        if (!isBackoffExpired(entry)) {
          console.debug(
            `[CleanTrack Sync] Payment ${entry.localId} in back-off ` +
              `(attempt ${entry.attempts}), skipping`
          );
          return null;
        }
        await syncPaymentEntry(entry);
        return entry.localId;
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value != null) doneLocalIds.add(r.value);
    }
    processed += chunk.length;
    onProgress?.(processed, total, "payments");
  }

  // ── Pass 5: sync pending pickups ─────────────────────────────────────────
  // Pickups run last so that create_order, status updates, and payments for
  // the same order are already committed server-side before the pickup POST.
  // For offline-created orders, dependsOn explicitly lists the order localId
  // plus any payment localIds computed at enqueuePickup() time.
  const pickupEntries = pending.filter(
    (e) => e.operation === "record_pickup"
  );

  for (let i = 0; i < pickupEntries.length; i += CONCURRENCY) {
    const chunk = pickupEntries.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (entry) => {
        const allDepsResolved = entry.dependsOn.every((dep) =>
          doneLocalIds.has(dep)
        );
        if (!allDepsResolved) {
          console.warn(
            `[CleanTrack Sync] Skipping pickup ${entry.localId} — unresolved dependencies: ` +
              entry.dependsOn.filter((d) => !doneLocalIds.has(d)).join(", ")
          );
          return null;
        }
        if (!isBackoffExpired(entry)) {
          console.debug(
            `[CleanTrack Sync] Pickup ${entry.localId} in back-off ` +
              `(attempt ${entry.attempts}), skipping`
          );
          return null;
        }
        await syncPickupEntry(entry);
        return entry.localId;
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value != null) doneLocalIds.add(r.value);
    }
    processed += chunk.length;
    onProgress?.(processed, total, "pickups");
  }

  // Prune old syncLog entries to prevent unbounded growth.  Best-effort.
  pruneSyncLog().catch(() => {});
}

/**
 * Reset a single permanently-failed sync queue entry back to pending so the
 * engine will retry it on the next sync cycle.
 *
 * Safe to call from the UI at any time — no-ops on entries that are not
 * in the "failed" state so double-clicks / races are harmless.
 *
 * Resets:
 *  - status       → "pending"
 *  - attempts     → 0  (gives the entry a full fresh set of retries)
 *  - lastError    → null
 *  - lastAttemptAt → null  (no back-off delay on first retry)
 */
export async function requeueFailedEntry(entryId: number): Promise<void> {
  const entry = await localDb.syncQueue.get(entryId);
  if (!entry || entry.status !== "failed") return;

  await localDb.syncQueue.update(entryId, {
    status: "pending",
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  });

  await syncEngine.notifyQueueChanged();

  console.info(
    `[CleanTrack Sync] Manual requeue: entry ${entryId} ` +
      `(${entry.operation} / ${entry.localId}) reset to pending`
  );
}

/**
 * Reset every permanently-failed sync queue entry back to pending.
 *
 * All reset entries get attempts=0 so they immediately qualify for the
 * next sync cycle without waiting for any back-off window.
 *
 * Intended for the "Retry All" action in the failed-sync UI panel.
 */
export async function requeueAllFailed(): Promise<void> {
  const failedEntries = await localDb.syncQueue
    .where("status")
    .equals("failed")
    .toArray();

  if (failedEntries.length === 0) return;

  await localDb.syncQueue.bulkUpdate(
    failedEntries.map((e) => ({
      key: e.id!,
      changes: {
        status: "pending" as const,
        attempts: 0,
        lastError: null,
        lastAttemptAt: null,
      },
    }))
  );

  await syncEngine.notifyQueueChanged();

  console.info(
    `[CleanTrack Sync] Manual requeue: ${failedEntries.length} failed entry(ies) reset to pending`
  );
}

/**
 * POST a pending customer to the server, then patch the local record.
 *
 * On success:
 *  - localDb.customers → serverId set, syncStatus = "synced"
 *  - syncQueue entry   → status = "done"
 *  - syncLog           → success entry written
 *
 * On failure (< MAX_TRANSIENT_ATTEMPTS):
 *  - syncQueue entry   → status = "pending", attempts incremented
 *  - syncLog           → error entry written
 *
 * On permanent failure (>= MAX_TRANSIENT_ATTEMPTS):
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
  if (entry.attempts >= MAX_TRANSIENT_ATTEMPTS) {
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
    const newAttempts = clientErr ? MAX_TRANSIENT_ATTEMPTS : entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_TRANSIENT_ATTEMPTS;

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
        `[CleanTrack Sync] Customer ${localId} sync attempt ${newAttempts}/${MAX_TRANSIENT_ATTEMPTS} failed ` +
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
 * On failure (< MAX_TRANSIENT_ATTEMPTS):
 *  - syncQueue entry → status = "pending", attempts incremented
 *  - syncLog         → error entry written
 *
 * On permanent failure (>= MAX_TRANSIENT_ATTEMPTS):
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

  if (entry.attempts >= MAX_TRANSIENT_ATTEMPTS) {
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
    const newAttempts = clientErr ? MAX_TRANSIENT_ATTEMPTS : entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_TRANSIENT_ATTEMPTS;

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
        `[CleanTrack Sync] Order ${localId} sync attempt ${newAttempts}/${MAX_TRANSIENT_ATTEMPTS} failed ` +
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
 * On failure (< MAX_TRANSIENT_ATTEMPTS):
 *  - syncQueue entry   → status = "pending", attempts incremented
 *
 * On permanent failure (>= MAX_TRANSIENT_ATTEMPTS):
 *  - syncQueue entry   → status = "failed"
 */
export async function syncOrderStatusEntry(entry: SyncQueueEntry): Promise<void> {
  if (entry.attempts >= MAX_TRANSIENT_ATTEMPTS) {
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
    // ── Status transition conflict — permanent failure, no retry ──────────
    // A 409 from the server means the transition violates the state machine.
    // There is no point retrying: the server will always reject it.
    if (isStatusTransitionConflictHttpError(err)) {
      const error = err instanceof Error ? err.message : String(err);
      const conflictError = `CONFLICT:STATUS_TRANSITION:${error}`;

      await localDb.syncQueue.update(entry.id!, {
        status: "failed",
        attempts: MAX_TRANSIENT_ATTEMPTS,
        lastError: conflictError,
        lastAttemptAt: new Date().toISOString(),
      });

      // Mark the local order record as "conflict" so the UI can surface it.
      // Only relevant for offline-created orders that exist as local records;
      // server-synced orders ("srv-*" localIds) have no local order row.
      const p = entry.payload as unknown as OfflineStatusPayload;
      if (!p.localId.startsWith("srv-")) {
        const localOrder = await localDb.orders.get(p.localId);
        if (localOrder) {
          await localDb.orders.update(p.localId, { syncStatus: "conflict" });
        }
      }

      await localDb.syncLog.add({
        operation: "update_order_status",
        localId: entry.localId,
        serverId: null,
        success: false,
        error: conflictError,
        syncedAt: new Date().toISOString(),
      });

      console.error(
        `[CleanTrack Sync] Status update ${entry.id} rejected by state machine — ` +
          `permanent conflict: ${error}`
      );

      throw new StatusTransitionConflictError(
        (entry.payload as any)?.changes?.status ?? "?",
        (entry.payload as any)?.changes?.status ?? "?",
        error
      );
    }

    const error = err instanceof Error ? err.message : String(err);

    // 4xx validation errors will never succeed — permanently fail immediately.
    const clientErr = isClientError(err);
    const newAttempts = clientErr ? MAX_TRANSIENT_ATTEMPTS : entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_TRANSIENT_ATTEMPTS;

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
        `[CleanTrack Sync] Status update ${entry.id} attempt ${newAttempts}/${MAX_TRANSIENT_ATTEMPTS} failed ` +
          `(retry in ${nextBackoffSec}s): ${error}`
      );
    }

    throw err;
  }
}

/**
 * POST a pending payment to the server, then patch the local record.
 *
 * Financial safety layer (runs BEFORE the network call):
 *  - validatePaymentPreSync() checks amount > 0, order not already paid,
 *    and that the payment does not exceed the remaining balance.
 *  - Any FinancialConflictError is a permanent failure — the local payment
 *    record is flagged syncStatus="conflict" for manual review and the
 *    syncLog entry is prefixed "CONFLICT:<code>:".
 *
 * Error classification (priority order):
 *  1. FinancialConflictError → permanent fail + conflict flag
 *  2. isFinancialConflictHttpError (409 / 400 + keywords) → permanent fail + conflict flag
 *  3. isClientError (other 4xx) → permanent fail, no conflict flag
 *  4. Network / 5xx → retry with exponential backoff
 *
 * On success:
 *  - localDb.payments → orderId, receiptNumber, syncStatus = "synced"
 *  - syncQueue entry  → status = "done"
 *  - syncLog          → success entry
 *
 * On permanent failure:
 *  - syncQueue entry  → status = "failed", attempts = MAX_TRANSIENT_ATTEMPTS
 *  - localDb.payments → syncStatus = "conflict"  (financial conflicts only)
 *  - syncLog          → error entry (prefixed "CONFLICT:<code>:" for financial)
 *
 * On transient failure (< MAX_TRANSIENT_ATTEMPTS):
 *  - syncQueue entry  → status = "pending", attempts++, lastAttemptAt updated
 *  - syncLog          → error entry
 */
export async function syncPaymentEntry(entry: SyncQueueEntry): Promise<void> {
  if (entry.attempts >= MAX_TRANSIENT_ATTEMPTS) {
    throw new Error(`Payment ${entry.id} reached max sync attempts`);
  }

  await localDb.syncQueue.update(entry.id!, {
    status: "in_flight",
    lastAttemptAt: new Date().toISOString(),
  });

  try {
    const p = entry.payload as unknown as OfflinePaymentPayload;

    // ── Resolve server order ID ──────────────────────────────────────────
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

    // ── Financial safety pre-check ───────────────────────────────────────
    // Validates amount > 0, order not already paid, no overpayment.
    // Throws FinancialConflictError (permanent) or plain Error (transient).
    await validatePaymentPreSync(p, serverOrderId);

    // ── Send payment to server ───────────────────────────────────────────
    const response = await api.orders.recordPayment(serverOrderId, {
      amount: p.amount,
      method: p.method,
      ...(p.notes ? { notes: p.notes } : {}),
    }, entry.clientId);

    // ── Patch local records ──────────────────────────────────────────────
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

    // Notify sync engine so React Query subscribers (order-detail) can
    // immediately invalidate the order balance and payment list caches.
    syncEngine.notifyPaymentSynced(serverOrderId, entry.localId);

    console.info(
      `[CleanTrack Sync] Payment synced: localId=${entry.localId} → ` +
        `serverId=${response.id} receiptNumber=${response.receiptNumber}`
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // ── Classify the error ───────────────────────────────────────────────
    const isConflict =
      err instanceof FinancialConflictError || isFinancialConflictHttpError(err);
    const clientErr = !isConflict && isClientError(err);
    const newAttempts =
      isConflict || clientErr ? MAX_TRANSIENT_ATTEMPTS : entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_TRANSIENT_ATTEMPTS;

    // Financial conflicts flag the local payment for manual review.
    if (isConflict) {
      await localDb.payments.update(entry.localId, { syncStatus: "conflict" });
    }

    await localDb.syncQueue.update(entry.id!, {
      status: permanentlyFailed ? "failed" : "pending",
      attempts: newAttempts,
      lastError: error,
      lastAttemptAt: new Date().toISOString(),
    });

    // Log conflicts with a structured "CONFLICT:<code>:" prefix so the UI
    // and any future audit tooling can filter them precisely.
    const conflictCode =
      err instanceof FinancialConflictError ? err.code : "PAYMENT_CONFLICT";
    const logError = isConflict ? `CONFLICT:${conflictCode}: ${error}` : error;

    await localDb.syncLog.add({
      operation: "record_payment",
      localId: entry.localId,
      serverId: null,
      success: false,
      error: logError,
      syncedAt: new Date().toISOString(),
    });

    if (isConflict) {
      console.error(
        `[CleanTrack Sync] Payment ${entry.id} financial conflict (${conflictCode}) — ` +
          `flagged for manual review: ${error}`
      );
    } else if (clientErr) {
      console.error(
        `[CleanTrack Sync] Payment ${entry.id} permanently failed (4xx — not retryable): ${error}`
      );
    } else if (permanentlyFailed) {
      console.error(
        `[CleanTrack Sync] Payment ${entry.id} permanently failed after ${newAttempts} attempts: ${error}`
      );
    } else {
      const nextBackoffSec = Math.round(computeBackoffMs(newAttempts) / 1_000);
      console.warn(
        `[CleanTrack Sync] Payment ${entry.id} attempt ${newAttempts}/${MAX_TRANSIENT_ATTEMPTS} failed ` +
          `(retry in ${nextBackoffSec}s): ${error}`
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
 * On failure (< MAX_TRANSIENT_ATTEMPTS):
 *  - syncQueue entry   → status = "pending", attempts incremented
 *  - syncLog           → error entry written
 *
 * On permanent failure (>= MAX_TRANSIENT_ATTEMPTS):
 *  - syncQueue entry   → status = "failed"
 *  - syncLog           → error entry written
 */
export async function syncPickupEntry(entry: SyncQueueEntry): Promise<void> {
  if (entry.attempts >= MAX_TRANSIENT_ATTEMPTS) {
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

    // ── Pre-sync validation ──────────────────────────────────────────────
    // Checks order status and per-item remaining quantities before hitting
    // the pickup endpoint.  A PickupConflictError here is a permanent failure.
    await validatePickupPreSync(p, serverOrderId);

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

    // Notify sync engine so React Query subscribers (order-detail) can
    // immediately invalidate the order status, quantities, and pickup list.
    syncEngine.notifyPickupSynced(serverOrderId, entry.localId);

    console.info(
      `[CleanTrack Sync] Pickup synced: localId=${entry.localId} → serverId=${response.pickup.id} (orderId=${serverOrderId})`
    );
  } catch (err) {
    // ── Conflict path — permanent failure, no retry ──────────────────────
    if (err instanceof PickupConflictError) {
      const conflictError = `CONFLICT:${err.code}:${err.message}`;

      await localDb.pickups.update(entry.localId, {
        syncStatus: "conflict",
      });

      await localDb.syncQueue.update(entry.id!, {
        status: "failed",
        attempts: entry.attempts + 1,
        lastError: conflictError,
      });

      await localDb.syncLog.add({
        operation: "record_pickup",
        localId: entry.localId,
        serverId: null,
        success: false,
        error: conflictError,
        syncedAt: new Date().toISOString(),
      });

      console.error(
        `[CleanTrack Sync] Pickup ${entry.id} conflict (${err.code}): ${err.message}`
      );

      throw err;
    }

    // ── Transient error path — increment attempts, apply backoff ─────────
    const error = err instanceof Error ? err.message : String(err);
    const newAttempts = entry.attempts + 1;
    const permanentlyFailed = newAttempts >= MAX_TRANSIENT_ATTEMPTS;

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
        `[CleanTrack Sync] Pickup ${entry.id} attempt ${newAttempts}/${MAX_TRANSIENT_ATTEMPTS} failed: ${error}`
      );
    }

    throw err;
  }
}
