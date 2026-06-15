import { Router } from "express";
import { db } from "@workspace/db";
import {
  auditLog,
  paymentRecords,
  pickupRecords,
  orders,
  workers,
  branches,
  deviceHeartbeats,
  messageQueue,
} from "@workspace/db/schema";
import { eq, and, gte, desc, sql, ilike, or } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { requireOwner } from "../middleware/auth.js";

export const operationsRouter = Router();

function periodToDate(period: string): Date {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === "7d") return new Date(now.getTime() - 7 * 86400000);
  if (period === "30d") return new Date(now.getTime() - 30 * 86400000);
  if (period === "90d") return new Date(now.getTime() - 90 * 86400000);
  return new Date(now.getTime() - 7 * 86400000);
}

function getLimit(raw: unknown, max = 200): number {
  const n = parseInt(raw as string);
  if (!n || n < 1) return 100;
  return Math.min(n, max);
}

function getOffset(raw: unknown): number {
  const n = parseInt(raw as string);
  return !n || n < 0 ? 0 : n;
}

operationsRouter.get("/audit-log", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const q = req.query as Record<string, string>;
    const since = periodToDate(q.period || "7d");
    const limit = getLimit(q.limit);
    const offset = getOffset(q.offset);

    const conditions: any[] = [
      eq(auditLog.laundryId, laundryId),
      gte(auditLog.createdAt, since),
    ];
    if (q.action) conditions.push(ilike(auditLog.action, `%${q.action}%`));
    if (q.actorType === "owner" || q.actorType === "worker") {
      conditions.push(eq(auditLog.actorType, q.actorType));
    }
    if (q.actorName) conditions.push(ilike(auditLog.actorName, `%${q.actorName}%`));

    const where = and(...conditions);

    const [entries, [countRow]] = await Promise.all([
      db
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          actorType: auditLog.actorType,
          actorName: auditLog.actorName,
          action: auditLog.action,
          orderId: auditLog.orderId,
          orderRef: orders.orderId,
          customerName: orders.customerName,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(orders, eq(auditLog.orderId, orders.id))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(where),
    ]);

    res.json({ entries, total: countRow.total });
  } catch (err) {
    console.error("operations/audit-log error:", err);
    res.status(500).json({ error: "Failed to load audit log" });
  }
});

operationsRouter.get("/payments", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const q = req.query as Record<string, string>;
    const since = periodToDate(q.period || "7d");
    const limit = getLimit(q.limit);
    const offset = getOffset(q.offset);

    const conditions: any[] = [
      eq(paymentRecords.laundryId, laundryId),
      gte(paymentRecords.recordedAt, since),
    ];
    if (q.method && ["cash", "transfer", "pos"].includes(q.method)) {
      conditions.push(eq(paymentRecords.method, q.method as "cash" | "transfer" | "pos"));
    }
    if (q.branchId) {
      conditions.push(eq(paymentRecords.branchId, parseInt(q.branchId)));
    }
    if (q.recordedBy) {
      conditions.push(ilike(paymentRecords.recordedBy, `%${q.recordedBy}%`));
    }

    const where = and(...conditions);

    const [payments, [countRow], [sumRow]] = await Promise.all([
      db
        .select({
          id: paymentRecords.id,
          receiptNumber: paymentRecords.receiptNumber,
          amount: paymentRecords.amount,
          method: paymentRecords.method,
          notes: paymentRecords.notes,
          remainingBalance: paymentRecords.remainingBalance,
          recordedBy: paymentRecords.recordedBy,
          recordedAt: paymentRecords.recordedAt,
          branchId: paymentRecords.branchId,
          branchName: branches.name,
          orderId: paymentRecords.orderId,
          orderRef: orders.orderId,
          customerName: orders.customerName,
          phone: orders.phone,
          workerName: workers.name,
        })
        .from(paymentRecords)
        .leftJoin(orders, eq(paymentRecords.orderId, orders.id))
        .leftJoin(workers, eq(paymentRecords.workerId, workers.id))
        .leftJoin(branches, eq(paymentRecords.branchId, branches.id))
        .where(where)
        .orderBy(desc(paymentRecords.recordedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(paymentRecords)
        .where(where),
      db
        .select({ totalAmount: sql<string>`coalesce(sum(amount::numeric), 0)::text` })
        .from(paymentRecords)
        .where(where),
    ]);

    res.json({ payments, total: countRow.total, totalAmount: sumRow.totalAmount });
  } catch (err) {
    console.error("operations/payments error:", err);
    res.status(500).json({ error: "Failed to load payments" });
  }
});

operationsRouter.get("/pickups", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const q = req.query as Record<string, string>;
    const since = periodToDate(q.period || "7d");
    const limit = getLimit(q.limit);
    const offset = getOffset(q.offset);

    const conditions: any[] = [
      eq(pickupRecords.laundryId, laundryId),
      gte(pickupRecords.createdAt, since),
    ];
    if (q.recordedBy) {
      conditions.push(ilike(pickupRecords.recordedBy, `%${q.recordedBy}%`));
    }

    const where = and(...conditions);

    const [pickups, [countRow]] = await Promise.all([
      db
        .select({
          id: pickupRecords.id,
          orderId: pickupRecords.orderId,
          orderRef: orders.orderId,
          customerName: orders.customerName,
          phone: orders.phone,
          shirtsPickedUp: pickupRecords.shirtsPickedUp,
          trousersPickedUp: pickupRecords.trousersPickedUp,
          itemPickups: pickupRecords.itemPickups,
          notes: pickupRecords.notes,
          recordedBy: pickupRecords.recordedBy,
          workerName: workers.name,
          createdAt: pickupRecords.createdAt,
        })
        .from(pickupRecords)
        .leftJoin(orders, eq(pickupRecords.orderId, orders.id))
        .leftJoin(workers, eq(pickupRecords.processedBy, workers.id))
        .where(where)
        .orderBy(desc(pickupRecords.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(pickupRecords)
        .where(where),
    ]);

    res.json({ pickups, total: countRow.total });
  } catch (err) {
    console.error("operations/pickups error:", err);
    res.status(500).json({ error: "Failed to load pickups" });
  }
});

operationsRouter.get("/worker-activity", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const q = req.query as Record<string, string>;
    const since = periodToDate(q.period || "7d");
    const limit = getLimit(q.limit);
    const offset = getOffset(q.offset);

    const conditions: any[] = [
      eq(auditLog.laundryId, laundryId),
      gte(auditLog.createdAt, since),
      eq(auditLog.actorType, "worker"),
    ];
    if (q.actorName) conditions.push(ilike(auditLog.actorName, `%${q.actorName}%`));
    if (q.action) conditions.push(ilike(auditLog.action, `%${q.action}%`));

    const where = and(...conditions);

    const [entries, [countRow]] = await Promise.all([
      db
        .select({
          id: auditLog.id,
          actorId: auditLog.actorId,
          actorName: auditLog.actorName,
          action: auditLog.action,
          orderId: auditLog.orderId,
          orderRef: orders.orderId,
          customerName: orders.customerName,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(orders, eq(auditLog.orderId, orders.id))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(where),
    ]);

    const summary = await db
      .select({
        actorName: auditLog.actorName,
        actorId: auditLog.actorId,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLog)
      .where(where)
      .groupBy(auditLog.actorName, auditLog.actorId)
      .orderBy(desc(sql`count(*)`));

    res.json({ entries, total: countRow.total, summary });
  } catch (err) {
    console.error("operations/worker-activity error:", err);
    res.status(500).json({ error: "Failed to load worker activity" });
  }
});

operationsRouter.get("/health", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const since24h = new Date(Date.now() - 86400000);
    const since7d = new Date(Date.now() - 7 * 86400000);

    const [
      orderStatusCounts,
      paymentMethodCounts,
      recentPayments,
      recentPickups,
      recentAuditActions,
    ] = await Promise.all([
      db
        .select({
          status: orders.status,
          count: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(eq(orders.laundryId, laundryId))
        .groupBy(orders.status),
      db
        .select({
          method: paymentRecords.method,
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(amount::numeric),0)::text`,
        })
        .from(paymentRecords)
        .where(and(eq(paymentRecords.laundryId, laundryId), gte(paymentRecords.recordedAt, since7d)))
        .groupBy(paymentRecords.method),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(paymentRecords)
        .where(and(eq(paymentRecords.laundryId, laundryId), gte(paymentRecords.recordedAt, since24h))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pickupRecords)
        .where(and(eq(pickupRecords.laundryId, laundryId), gte(pickupRecords.createdAt, since24h))),
      db
        .select({
          action: auditLog.action,
          count: sql<number>`count(*)::int`,
        })
        .from(auditLog)
        .where(and(eq(auditLog.laundryId, laundryId), gte(auditLog.createdAt, since7d)))
        .groupBy(auditLog.action)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
    ]);

    res.json({
      orders: {
        byStatus: orderStatusCounts,
      },
      payments: {
        byMethod: paymentMethodCounts,
        last24h: recentPayments[0]?.count ?? 0,
      },
      pickups: {
        last24h: recentPickups[0]?.count ?? 0,
      },
      topActions: recentAuditActions,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("operations/health error:", err);
    res.status(500).json({ error: "Failed to load health data" });
  }
});

/**
 * GET /api/operations/sync-health
 *
 * Returns one row per worker device that has sent a heartbeat for this
 * laundry. Each row includes current queue metrics (pending / failed /
 * conflict counts), the staleness classification (fresh / stale /
 * very_stale), and a pre-computed minutesSinceLastSeen integer for the UI.
 *
 * Staleness bands:
 *   fresh      — lastSeenAt within 5 minutes
 *   stale      — 5 – 60 minutes since last heartbeat
 *   very_stale — more than 60 minutes
 *
 * The summary object contains fleet-level counts for the owner dashboard
 * headline cards (active / stale / with-conflicts etc.).
 */
operationsRouter.get("/sync-health", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const now = new Date();

    const rows = await db
      .select({
        id: deviceHeartbeats.id,
        deviceId: deviceHeartbeats.deviceId,
        actorType: deviceHeartbeats.actorType,
        workerName: deviceHeartbeats.workerName,
        workerId: deviceHeartbeats.workerId,
        branchId: deviceHeartbeats.branchId,
        branchName: branches.name,
        pendingCount: deviceHeartbeats.pendingCount,
        failedCount: deviceHeartbeats.failedCount,
        conflictCount: deviceHeartbeats.conflictCount,
        recoveryCount: deviceHeartbeats.recoveryCount,
        isOnline: deviceHeartbeats.isOnline,
        appVersion: deviceHeartbeats.appVersion,
        lastSyncedAt: deviceHeartbeats.lastSyncedAt,
        lastSeenAt: deviceHeartbeats.lastSeenAt,
        createdAt: deviceHeartbeats.createdAt,
      })
      .from(deviceHeartbeats)
      .leftJoin(branches, eq(branches.id, deviceHeartbeats.branchId))
      .where(eq(deviceHeartbeats.laundryId, laundryId))
      .orderBy(desc(deviceHeartbeats.lastSeenAt));

    const devices = rows.map((d) => {
      const msSince = now.getTime() - new Date(d.lastSeenAt).getTime();
      const minutesSince = msSince / 60_000;
      const staleness: "fresh" | "stale" | "very_stale" =
        minutesSince < 5 ? "fresh" : minutesSince < 60 ? "stale" : "very_stale";
      return {
        ...d,
        lastSeenAt: d.lastSeenAt.toISOString(),
        lastSyncedAt: d.lastSyncedAt ? d.lastSyncedAt.toISOString() : null,
        createdAt: d.createdAt.toISOString(),
        staleness,
        minutesSinceLastSeen: Math.round(minutesSince),
      };
    });

    const summary = {
      total: devices.length,
      active: devices.filter((d) => d.staleness === "fresh").length,
      stale: devices.filter((d) => d.staleness === "stale").length,
      veryStale: devices.filter((d) => d.staleness === "very_stale").length,
      withConflicts: devices.filter((d) => d.conflictCount > 0).length,
      withPending: devices.filter((d) => d.pendingCount > 0).length,
      withFailed: devices.filter((d) => d.failedCount > 0).length,
      offline: devices.filter((d) => !d.isOnline).length,
    };

    return res.json({ devices, summary, generatedAt: now.toISOString() });
  } catch (err) {
    console.error("operations/sync-health error:", err);
    return res.status(500).json({ error: "Failed to load sync health data" });
  }
});

/**
 * GET /api/operations/failed-messages
 *
 * Returns all failed message_queue entries scoped to the owner's laundry.
 * Ordered by most recently created first.
 */
operationsRouter.get("/failed-messages", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const [entries, [countRow]] = await Promise.all([
      db
        .select({
          id: messageQueue.id,
          templateName: messageQueue.templateName,
          recipientPhone: messageQueue.recipientPhone,
          recipientName: messageQueue.recipientName,
          channel: messageQueue.channel,
          status: messageQueue.status,
          attempts: messageQueue.attempts,
          maxAttempts: messageQueue.maxAttempts,
          lastError: messageQueue.lastError,
          lastAttemptAt: messageQueue.lastAttemptAt,
          nextRetryAt: messageQueue.nextRetryAt,
          notificationEventId: messageQueue.notificationEventId,
          createdAt: messageQueue.createdAt,
        })
        .from(messageQueue)
        .where(and(eq(messageQueue.laundryId, laundryId), eq(messageQueue.status, "failed")))
        .orderBy(desc(messageQueue.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(messageQueue)
        .where(and(eq(messageQueue.laundryId, laundryId), eq(messageQueue.status, "failed"))),
    ]);

    const formatted = entries.map((e) => ({
      ...e,
      lastAttemptAt: e.lastAttemptAt?.toISOString() ?? null,
      nextRetryAt: e.nextRetryAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    }));

    res.json({ entries: formatted, total: countRow.total });
  } catch (err) {
    console.error("operations/failed-messages error:", err);
    res.status(500).json({ error: "Failed to load failed messages" });
  }
});

/**
 * POST /api/operations/failed-messages/:id/requeue
 *
 * Resets a dead-lettered message back to pending so the worker will retry it.
 */
operationsRouter.post("/failed-messages/:id/requeue", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid message id" });
    }

    const [entry] = await db
      .select({ id: messageQueue.id, laundryId: messageQueue.laundryId, status: messageQueue.status })
      .from(messageQueue)
      .where(and(eq(messageQueue.id, id), eq(messageQueue.laundryId, laundryId)));

    if (!entry) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (entry.status !== "failed") {
      return res.status(409).json({ error: `Message is in '${entry.status}' status — only 'failed' messages can be re-queued` });
    }

    const [updated] = await db
      .update(messageQueue)
      .set({
        status: "pending",
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(messageQueue.id, id), eq(messageQueue.laundryId, laundryId)))
      .returning();

    res.json({
      id: updated.id,
      status: updated.status,
      message: "Message re-queued for delivery",
    });
  } catch (err) {
    console.error("operations/failed-messages requeue error:", err);
    res.status(500).json({ error: "Failed to re-queue message" });
  }
});
