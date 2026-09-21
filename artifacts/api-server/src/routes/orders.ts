import { Router } from "express";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { idempotencyMiddleware } from "../lib/idempotency.js";
import { orders, paymentRecords, orderItems, customers, laundries, services, priceAdjustments, discountApprovals, auditLog, branches, workers, workerPermissions, orderMovements, notificationMessages, notificationEvents, notifications } from "@workspace/db/schema";
import { eq, desc, and, count, inArray, sql, isNull } from "drizzle-orm";
import { computeOrderPricing } from "../lib/order-financials.js";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { requireOperational, requirePlanLimit } from "../middleware/subscription.js";
import { logAction, actorName } from "../lib/audit.js";
import { emitEvent } from "../lib/events.js";
import { dispatchNotification, buildOrderVariables } from "../lib/notification-dispatcher.js";
import { trackActivationEvent } from "../lib/activation-tracker.js";
import { fireAutomation } from "../lib/automation-service.js";

export const ordersRouter = Router();

const orderCollectionBranch = alias(branches, "order_collection_branch");
const orderProcessingBranch = alias(branches, "order_processing_branch");
const orderReturnBranch = alias(branches, "order_return_branch");
const orderCurrentBranch = alias(branches, "order_current_branch");

const DEFAULT_TURNAROUND: Record<string, number> = { express: 24, premium: 48, standard: 72 };

/**
 * Generates a unique, collision-free receipt number using an atomic
 * INSERT … ON CONFLICT DO UPDATE counter row per calendar date.
 *
 * Why not MAX()+1?  MAX()+1 has a race window: two concurrent transactions
 * both read the same MAX, both compute the same next value, and one of them
 * hits a unique-constraint violation.  The old retry-loop mitigation fails
 * under high concurrency and across multiple Node processes.
 *
 * The counter table approach is atomic at the database level — PostgreSQL
 * serialises all writers on the single counter row for a given date, so
 * every call gets a strictly unique, monotonically increasing suffix with
 * no retry needed, even across multiple processes or servers.
 *
 * Format: RCT-YYYYMMDD-NNNN  (NNNN resets to 0001 each calendar day)
 *
 * @param tx  The active Drizzle transaction.  Receipt number generation MUST
 *            happen inside the same transaction that inserts the payment record
 *            so that a rolled-back payment also rolls back its counter increment.
 */
async function generateReceiptNumber(tx: typeof db): Promise<string> {
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `RCT-${datePart}-`;
  // Self-initialising: on the very first call for a given date the INSERT
  // reads MAX(existing suffix) from payment_records (handles pre-seeded data
  // and legacy rows) so the counter never collides with already-stored receipts.
  // Concurrent first-time callers: one wins the INSERT; the other hits
  // ON CONFLICT DO UPDATE and increments atomically — both get unique values.
  // Ignore legacy/demo receipt suffixes that are not numeric so they cannot
  // cause PostgreSQL 22P02 while initializing the daily counter.
  const result = await tx.execute(
    sql`INSERT INTO receipt_number_counters (date_part, counter)
        SELECT
          ${datePart},
          COALESCE(
            MAX(
              CASE
                WHEN SUBSTRING(receipt_number FROM ${sql.raw(String(prefix.length + 1))}) ~ '^[0-9]+$'
                THEN CAST(SUBSTRING(receipt_number FROM ${sql.raw(String(prefix.length + 1))}) AS INTEGER)
              END
            ),
            0
          ) + 1
        FROM payment_records
        WHERE receipt_number LIKE ${prefix + "%"}
        ON CONFLICT (date_part) DO UPDATE
        SET counter = receipt_number_counters.counter + 1
        RETURNING counter`
  );
  const counter = (result as any).rows?.[0]?.counter ?? 1;
  return `${prefix}${String(counter).padStart(4, "0")}`;
}

/**
 * Generates a human-friendly order ID using an atomic daily counter.
 *
 * Format: ORD-YYMMDD-NNN  (e.g. ORD-260720-001)
 *
 * Uses the same INSERT … ON CONFLICT DO UPDATE pattern as receipt numbers:
 * PostgreSQL serialises all writers on the counter row, so every call gets a
 * strictly unique, monotonically increasing suffix — no retry needed, even
 * across multiple Node processes or concurrent workers.
 *
 * The counter resets at midnight (calendar day change). If a day ever exceeds
 * 999 orders the suffix naturally grows to 4+ digits without breaking anything
 * (the unique constraint is on the text value, length is unlimited).
 *
 * Backward compatibility: existing records with the old 14-digit numeric
 * format remain valid — uniqueness is on the text value regardless of format.
 */
async function generateOrderId(tx: typeof db): Promise<string> {
  const today = new Date();
  const yr = String(today.getFullYear()).slice(2);
  const mo = String(today.getMonth() + 1).padStart(2, "0");
  const dy = String(today.getDate()).padStart(2, "0");
  const datePart = `${yr}${mo}${dy}`;

  const result = await tx.execute(
    sql`INSERT INTO order_number_counters (date_part, counter)
        VALUES (${datePart}, 1)
        ON CONFLICT (date_part) DO UPDATE
        SET counter = order_number_counters.counter + 1
        RETURNING counter`
  );
  const counter = (result as any).rows?.[0]?.counter ?? 1;
  return `ORD-${datePart}-${String(counter).padStart(3, "0")}`;
}

async function getLaundrySla(laundryId: number) {
  const [laundry] = await db
    .select({
      standardTurnaroundHours: laundries.standardTurnaroundHours,
      expressTurnaroundHours: laundries.expressTurnaroundHours,
      premiumTurnaroundHours: laundries.premiumTurnaroundHours,
    })
    .from(laundries)
    .where(eq(laundries.id, laundryId));
  return laundry ?? { standardTurnaroundHours: 72, expressTurnaroundHours: 24, premiumTurnaroundHours: 48 };
}

function computeProcessingDueAt(createdAt: Date, serviceType: string, sla: { standardTurnaroundHours: number; expressTurnaroundHours: number; premiumTurnaroundHours: number }): Date {
  const hours = serviceType === "express" ? sla.expressTurnaroundHours
    : serviceType === "premium" ? sla.premiumTurnaroundHours
    : sla.standardTurnaroundHours;
  return new Date(createdAt.getTime() + hours * 3600000);
}

const orderItemInputSchema = z.object({
  serviceId: z.number().int(),
  quantity: z.number().int().min(1),
});

const orderInputSchema = z.object({
  customerName: z.string().min(1),
  phone: z.string().min(1),
  address: z.string().optional(),
  customerId: z.number().int().optional(),
  serviceType: z.enum(["standard", "express", "premium"]).default("standard"),
  items: z.array(orderItemInputSchema).optional(),
  shirts: z.number().int().min(0).optional().default(0),
  trousers: z.number().int().min(0).optional().default(0),
  additionalNotes: z.string().optional(),
  price: z.number().optional(),
  extraCharge: z.number().optional(),
  extraChargeReason: z.string().optional(),
  discount: z.number().min(0).optional(),
  discountReason: z.string().optional(),
  // Legacy compatibility: branchId means collection branch only.
  branchId: z.number().int().positive().optional(),
  collectionBranchId: z.number().int().positive().optional(),
  processingBranchId: z.number().int().positive().optional(),
  returnBranchId: z.number().int().positive().optional(),
});

/**
 * Server-side order status state machine.
 *
 * Only transitions listed here are permitted via PATCH /orders/:id.
 * partial_pickup and completed are terminal-for-PATCH: they are set
 * exclusively by the pickup route (POST /orders/:id/pickups) and can
 * never be written directly through the update endpoint.
 */
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending:        ["processing", "cancelled"],
  processing:     ["ready", "cancelled"],
  ready:          [],          // advance only via pickup route
  partial_pickup: [],          // advance only via pickup route
  completed:      [],          // terminal
  cancelled:      [],          // terminal
};

const orderMovementSchema = z.object({
  // Guided handoffs may omit the target because CleanTrack already knows the
  // order's assigned processing/return branch. Owners can still supply it for
  // manual transfers.
  toBranchId: z.number().int().positive().optional(),
  movementType: z.enum(["PROCESSING_TRANSFER", "RETURN_TRANSFER", "MANUAL_TRANSFER"]),
  reason: z.string().max(500).optional(),
});
const workerOrderUpdateSchema = z.object({
  status: z.enum(["pending", "processing", "ready", "partial_pickup", "completed", "cancelled"]).optional(),
  verifiedShirts: z.number().int().min(0).optional(),
  verifiedTrousers: z.number().int().min(0).optional(),
  isVerified: z.boolean().optional(),
  additionalNotes: z.string().optional(),
  assignedWorkerId: z.number().int().nullable().optional(),
});

const ownerOrderUpdateSchema = workerOrderUpdateSchema.extend({
  price: z.number().min(0).optional(),
  extraCharge: z.number().min(0).optional(),
  discount: z.number().min(0).optional(),
});

ordersRouter.get("/", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { status, paymentStatus, limit = "500", offset = "0", branchId: branchParam } = req.query;
    const conditions: any[] = [eq(orders.laundryId, laundryId)];
    if (status) conditions.push(eq(orders.status, status as string));
    if (paymentStatus) conditions.push(eq(orders.paymentStatus, paymentStatus as string));

    // Branch scoping: workers are locked to their branch; owners can filter by ?branchId
    const effectiveBranchId = req.auth!.branchId ?? (branchParam ? parseInt(branchParam as string) : null);
    if (effectiveBranchId) conditions.push(eq(orders.currentBranchId, effectiveBranchId));

    const [orderRows, [{ total }]] = await Promise.all([
      db.select({
        order: orders,
        collectionBranchName: orderCollectionBranch.name,
        collectionBranchType: orderCollectionBranch.type,
        processingBranchName: orderProcessingBranch.name,
        processingBranchType: orderProcessingBranch.type,
        returnBranchName: orderReturnBranch.name,
        returnBranchType: orderReturnBranch.type,
        currentBranchName: orderCurrentBranch.name,
        currentBranchType: orderCurrentBranch.type,
      })
        .from(orders)
        .leftJoin(orderCollectionBranch, eq(orderCollectionBranch.id, orders.collectionBranchId))
        .leftJoin(orderProcessingBranch, eq(orderProcessingBranch.id, orders.processingBranchId))
        .leftJoin(orderReturnBranch, eq(orderReturnBranch.id, orders.returnBranchId))
        .leftJoin(orderCurrentBranch, eq(orderCurrentBranch.id, orders.currentBranchId))
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt))
        .limit(parseInt(limit as string))
        .offset(parseInt(offset as string)),
      db.select({ total: count() }).from(orders).where(and(...conditions)),
    ]);

    const orderList = orderRows.map(row => ({
      ...row.order,
      collectionBranchName: row.collectionBranchName,
      collectionBranchType: row.collectionBranchType,
      processingBranchName: row.processingBranchName,
      processingBranchType: row.processingBranchType,
      returnBranchName: row.returnBranchName,
      returnBranchType: row.returnBranchType,
      currentBranchName: row.currentBranchName,
      currentBranchType: row.currentBranchType,
    }));

    res.json(orderList);
  } catch {
    res.status(500).json({ error: "Failed to list orders" });
  }
});

ordersRouter.get("/summary", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { branchId: branchParam } = req.query;
    const effectiveBranchId = req.auth!.branchId ?? (branchParam ? parseInt(branchParam as string) : null);
    const summaryConditions: any[] = [eq(orders.laundryId, laundryId)];
    if (effectiveBranchId) summaryConditions.push(eq(orders.currentBranchId, effectiveBranchId));
    const result = await db.select().from(orders).where(and(...summaryConditions));
    res.json({
      total: result.length,
      pending: result.filter(o => o.status === "pending").length,
      processing: result.filter(o => o.status === "processing").length,
      ready: result.filter(o => o.status === "ready").length,
      completed: result.filter(o => o.status === "completed").length,
      unpaid: result.filter(o => o.paymentStatus === "unpaid").length,
      partial: result.filter(o => o.paymentStatus === "partial").length,
      paid: result.filter(o => o.paymentStatus === "paid").length,
      totalRevenue: result.reduce((sum, o) => sum + parseFloat(o.price || "0") + parseFloat(o.extraCharge || "0") - parseFloat(o.discount || "0"), 0),
      outstandingBalance: result
        .filter(o => o.paymentStatus !== "paid")
        .reduce((sum, o) => {
          const totalDue = parseFloat(o.price || "0") + parseFloat(o.extraCharge || "0") - parseFloat(o.discount || "0");
          return sum + Math.max(0, totalDue - parseFloat(o.amountPaid || "0"));
        }, 0),
    });
  } catch {
    res.status(500).json({ error: "Failed to get order summary" });
  }
});

ordersRouter.get("/recent", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { branchId: branchParam } = req.query;
    const effectiveBranchId = req.auth!.branchId ?? (branchParam ? parseInt(branchParam as string) : null);
    const conditions: any[] = [eq(orders.laundryId, laundryId)];
    if (effectiveBranchId) conditions.push(eq(orders.currentBranchId, effectiveBranchId));
    const recentOrders = await db.select().from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt))
      .limit(10);
    res.json(recentOrders);
  } catch {
    res.status(500).json({ error: "Failed to get recent orders" });
  }
});

ordersRouter.get("/:id", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const idConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) idConditions.push(eq(orders.currentBranchId, workerBranchId));
    const [orderRow] = await db.select({
      order: orders,
      collectionBranchName: orderCollectionBranch.name,
      collectionBranchType: orderCollectionBranch.type,
      processingBranchName: orderProcessingBranch.name,
      processingBranchType: orderProcessingBranch.type,
      returnBranchName: orderReturnBranch.name,
      returnBranchType: orderReturnBranch.type,
      currentBranchName: orderCurrentBranch.name,
      currentBranchType: orderCurrentBranch.type,
    })
      .from(orders)
      .leftJoin(orderCollectionBranch, eq(orderCollectionBranch.id, orders.collectionBranchId))
      .leftJoin(orderProcessingBranch, eq(orderProcessingBranch.id, orders.processingBranchId))
      .leftJoin(orderReturnBranch, eq(orderReturnBranch.id, orders.returnBranchId))
      .leftJoin(orderCurrentBranch, eq(orderCurrentBranch.id, orders.currentBranchId))
      .where(and(...idConditions));
    if (!orderRow) return res.status(404).json({ error: "Order not found" });

    const order = {
      ...orderRow.order,
      collectionBranchName: orderRow.collectionBranchName,
      collectionBranchType: orderRow.collectionBranchType,
      processingBranchName: orderRow.processingBranchName,
      processingBranchType: orderRow.processingBranchType,
      returnBranchName: orderRow.returnBranchName,
      returnBranchType: orderRow.returnBranchType,
      currentBranchName: orderRow.currentBranchName,
      currentBranchType: orderRow.currentBranchType,
    };

    const [items, adjustments] = await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
      db.select().from(priceAdjustments)
        .where(eq(priceAdjustments.orderId, order.id))
        .orderBy(priceAdjustments.createdAt),
    ]);

    res.json({ ...order, items, priceAdjustments: adjustments });
  } catch {
    res.status(500).json({ error: "Failed to get order" });
  }
});

ordersRouter.post("/", requireOperational, requirePlanLimit("orders"), checkPermission("process:orders"), idempotencyMiddleware, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const isOwner = req.auth!.type === "owner";
    const rawData = orderInputSchema.parse(req.body);

    // Workers cannot manually set pricing fields — price must come from catalog
    const data = isOwner ? rawData : {
      ...rawData,
      price: undefined,
      extraCharge: undefined,
      extraChargeReason: undefined,
      discount: undefined,
      discountReason: undefined,
    };

    const requestedCollectionBranchId = data.collectionBranchId ?? data.branchId;
    const workerBranchId = req.auth!.branchId ?? null;
    const collectionBranchId = workerBranchId ?? requestedCollectionBranchId ?? null;
    if (workerBranchId && requestedCollectionBranchId !== undefined && requestedCollectionBranchId !== workerBranchId) {
      return res.status(403).json({ error: "Workers can only create orders at their assigned branch" });
    }

    if (collectionBranchId == null) {
      return res.status(400).json({ error: "A collection branch is required to create an order" });
    }

    const activeBranches = await db.select({
      id: branches.id,
      type: branches.type,
      name: branches.name,
      processingDestinationBranchId: branches.processingDestinationBranchId,
    })
      .from(branches)
      .where(and(eq(branches.laundryId, laundryId), isNull(branches.deletedAt)));

    const collectionBranch = activeBranches.find(b => b.id === collectionBranchId);
    if (!collectionBranch) return res.status(403).json({ error: "Collection branch not found" });
    if (!["PICKUP", "HYBRID"].includes(collectionBranch.type)) {
      return res.status(400).json({ error: "This branch cannot receive customer orders" });
    }

    // Branch configuration is the routing source of truth. Workers do not
    // choose a processing destination for each order.
    const processingBranchId = collectionBranch.type === "HYBRID"
      ? collectionBranchId
      : collectionBranch.processingDestinationBranchId ?? null;

    if (collectionBranch.type === "PICKUP" && processingBranchId == null) {
      return res.status(409).json({
        error: "This Pickup branch has no processing destination configured. Ask the owner to configure it in Branches.",
        code: "PROCESSING_DESTINATION_NOT_CONFIGURED",
      });
    }

    // Return to the same branch where the customer handed the clothes in.
    const returnBranchId = collectionBranchId;

    if (data.processingBranchId != null && data.processingBranchId !== processingBranchId) {
      return res.status(400).json({
        error: "Processing destination is controlled by the collection branch configuration. Update the branch settings instead.",
        code: "PROCESSING_DESTINATION_CONFIGURED_AT_BRANCH",
      });
    }
    if (data.returnBranchId != null && data.returnBranchId !== returnBranchId) {
      return res.status(400).json({
        error: "Return branch is automatically the collection branch.",
        code: "RETURN_BRANCH_FOLLOWS_COLLECTION",
      });
    }

    const requestedBranches = [
      ["processing", processingBranchId],
      ["return", returnBranchId],
    ] as const;

    for (const [operation, branchId] of requestedBranches) {
      if (branchId == null) continue;
      const ownedBranch = activeBranches.find(b => b.id === branchId);
      if (!ownedBranch) return res.status(403).json({ error: operation + " branch not found" });
      const allowed = operation === "processing"
        ? ["PROCESSING", "HYBRID"].includes(ownedBranch.type)
        : ["PICKUP", "HYBRID"].includes(ownedBranch.type);
      if (!allowed) return res.status(400).json({ error: operation + " operation is not supported by the selected branch" });
    }

    if (processingBranchId == null) {
      return res.status(400).json({
        error: "No processing branch is configured. Add a Processing or Hybrid branch before creating orders.",
        code: "NO_PROCESSING_BRANCH",
      });
    }
    const sla = await getLaundrySla(laundryId);
    const createdAt = new Date();
    const processingDueAt = computeProcessingDueAt(createdAt, data.serviceType, sla);

    const result = await db.transaction(async (tx) => {
      let customerId: number | null = data.customerId ?? null;
      const phoneNorm = data.phone.trim();
      if (!customerId) {
        const [existingCustomer] = await tx.select().from(customers)
          .where(and(eq(customers.laundryId, laundryId), eq(customers.phone, phoneNorm)));
        if (existingCustomer) {
          customerId = existingCustomer.id;
          await tx.update(customers).set({ lastActivityAt: new Date() }).where(eq(customers.id, existingCustomer.id));
        } else {
          const [newCustomer] = await tx.insert(customers).values({ laundryId, fullName: data.customerName, phone: phoneNorm, address: data.address }).returning();
          customerId = newCustomer.id;
        }
      } else {
        const [ownedCustomer] = await tx.select().from(customers)
          .where(and(eq(customers.id, customerId), eq(customers.laundryId, laundryId)));
        if (!ownedCustomer) throw new Error("CUSTOMER_NOT_FOUND");
        await tx.update(customers).set({ lastActivityAt: new Date() }).where(eq(customers.id, customerId));
      }

      let computedPrice = data.price;
      let insertedItems: typeof orderItems.$inferSelect[] = [];
      let resolvedItems: Array<{ serviceId: number; name: string; quantity: number; unitPrice: number; lineTotal: number }> = [];
      if (data.items && data.items.length > 0) {
        const activeServices = await tx.select().from(services).where(and(eq(services.laundryId, laundryId), eq(services.isActive, true)));
        const serviceMap = new Map(activeServices.map(s => [s.id, s]));
        for (const item of data.items) {
          const svc = serviceMap.get(item.serviceId);
          if (!svc) throw new Error(`SERVICE_NOT_FOUND:${item.serviceId}`);
          const priceField = data.serviceType === "express" ? svc.expressPrice : data.serviceType === "premium" ? svc.premiumPrice : svc.standardPrice;
          const unitPrice = parseFloat(priceField ?? svc.standardPrice);
          resolvedItems.push({ serviceId: svc.id, name: svc.name, quantity: item.quantity, unitPrice, lineTotal: item.quantity * unitPrice });
        }
        computedPrice = resolvedItems.reduce((sum, i) => sum + i.lineTotal, 0);
      }

      const totalDue = (computedPrice ?? 0) + (data.extraCharge ?? 0) - (data.discount ?? 0);
      if (totalDue < 0) throw new Error("INVALID_ORDER_TOTAL");

      const placeholder = `GEN-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [inserted] = await tx.insert(orders).values({
        laundryId,
        // Legacy bridge: branchId remains the collection branch until all consumers migrate.
        branchId: collectionBranchId,
        collectionBranchId,
        processingBranchId,
        returnBranchId,
        currentBranchId: collectionBranchId,
        customerId, orderId: placeholder, customerName: data.customerName, phone: phoneNorm,
        address: data.address, serviceType: data.serviceType, shirts: data.shirts ?? 0, trousers: data.trousers ?? 0, additionalNotes: data.additionalNotes,
        price: computedPrice?.toString(), extraCharge: data.extraCharge?.toString(), discount: data.discount?.toString(), processingDueAt,
      }).returning();

      const finalOrderId = await generateOrderId(tx);
      await tx.update(orders).set({ orderId: finalOrderId }).where(eq(orders.id, inserted.id));

      if (resolvedItems.length > 0) {
        insertedItems = await tx.insert(orderItems).values(resolvedItems.map(item => ({
          orderId: inserted.id, serviceId: item.serviceId, serviceType: data.serviceType, name: item.name, quantity: item.quantity,
          unitPrice: item.unitPrice.toString(), totalPrice: item.lineTotal.toString(),
        }))).returning();
      }

      // One order, one source of truth. Record its first handoff location without
      // cloning the order into another branch.
      await tx.insert(orderMovements).values({
        laundryId,
        orderId: inserted.id,
        fromBranchId: null,
        toBranchId: collectionBranchId!,
        movementType: "COLLECTION",
        reason: "Order received at collection branch",
        movedByType: req.auth!.type,
        movedByName: actorName(req.auth!),
      });

      const adjustmentRows: typeof priceAdjustments.$inferInsert[] = [];
      const appliedBy = actorName(req.auth!);
      if (data.discount && data.discount > 0 && data.discountReason) adjustmentRows.push({ orderId: inserted.id, laundryId, type: "discount", amount: data.discount.toString(), reason: data.discountReason, appliedBy });
      if (data.extraCharge && data.extraCharge > 0 && data.extraChargeReason) adjustmentRows.push({ orderId: inserted.id, laundryId, type: "extra_charge", amount: data.extraCharge.toString(), reason: data.extraChargeReason, appliedBy });
      if (adjustmentRows.length > 0) await tx.insert(priceAdjustments).values(adjustmentRows);

      return { order: { ...inserted, orderId: finalOrderId }, insertedItems, computedPrice, phoneNorm };
    });

    const { order, insertedItems, computedPrice, phoneNorm } = result;

    const itemSummary = insertedItems.length > 0
      ? insertedItems.map(i => `${i.quantity}x ${i.name}`).join(", ")
      : `${order.shirts}s/${order.trousers}t`;

    emitEvent({
      laundryId,
      eventType: "new_order",
      title: "New Order Received",
      message: `Order #${order.orderId} for ${order.customerName} (${itemSummary}, ${order.serviceType}) — due ${processingDueAt.toLocaleString()}.`,
      severity: "info",
      relatedOrderId: order.id,
    }).catch(() => {});

    trackActivationEvent(laundryId, "order_created");

    fireAutomation({
      laundryId,
      triggerEvent: "ORDER_CREATED",
      customerName: order.customerName,
      customerPhone: order.phone,
      orderId: order.orderId,
    }).catch(() => {});

    logAction({
      auth: req.auth!,
      laundryId,
      action: "order_created",
      orderId: order.id,
      metadata: {
        orderId: order.orderId,
        customerName: order.customerName,
        serviceType: order.serviceType,
        price: computedPrice,
        items: itemSummary,
      },
    }).catch(() => {});

    res.status(201).json({ ...order, items: insertedItems });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to create order" });
  }
});

ordersRouter.get("/:id/movements", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isInteger(orderId)) return res.status(400).json({ error: "Invalid order id" });

    const conditions: any[] = [eq(orders.id, orderId), eq(orders.laundryId, laundryId)];
    if (req.auth!.branchId) conditions.push(eq(orders.currentBranchId, req.auth!.branchId));

    const [order] = await db.select({ id: orders.id }).from(orders).where(and(...conditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const fromBranch = alias(branches, "from_branch");
    const toBranch = alias(branches, "to_branch");

    const movements = await db
      .select({
        id: orderMovements.id,
        orderId: orderMovements.orderId,
        fromBranchId: orderMovements.fromBranchId,
        fromBranchName: fromBranch.name,
        toBranchId: orderMovements.toBranchId,
        toBranchName: toBranch.name,
        movementType: orderMovements.movementType,
        reason: orderMovements.reason,
        movedByType: orderMovements.movedByType,
        movedByName: orderMovements.movedByName,
        createdAt: orderMovements.createdAt,
      })
      .from(orderMovements)
      .leftJoin(fromBranch, eq(fromBranch.id, orderMovements.fromBranchId))
      .leftJoin(toBranch, eq(toBranch.id, orderMovements.toBranchId))
      .where(eq(orderMovements.orderId, orderId))
      .orderBy(desc(orderMovements.createdAt));

    res.json(movements);
  } catch (err) {
    console.error("[order-movements]", err);
    res.status(500).json({ error: "Failed to list order movements" });
  }
});

ordersRouter.post("/:id/move", async (req: AuthRequest, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isInteger(orderId)) return res.status(400).json({ error: "Invalid order id" });
    const data = orderMovementSchema.parse(req.body);
    const laundryId = req.auth!.laundryId;
    const isOwner = req.auth!.type === "owner";
    const workerBranchId = req.auth!.branchId ?? null;

    // Handoffs are operation-specific: Pickup workers need the pickup/collection
    // permission to send an order onward; processing workers need processing
    // permission to send finished work back. Neither operation grants processing
    // capability to a Pickup worker.
    if (!isOwner) {
      const allowed = data.movementType === "PROCESSING_TRANSFER"
        ? !!req.auth!.permissions?.canRecordPickups
        : data.movementType === "RETURN_TRANSFER"
          ? !!req.auth!.permissions?.canProcessOrders
          : false;
      if (!allowed) return res.status(403).json({ error: "You do not have permission to perform this branch handoff" });
    }

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.laundryId, laundryId)))
        .for("update");
      if (!order) return { notFound: true } as const;
      if (["completed", "cancelled"].includes(order.status)) return { terminal: true } as const;

      if (!isOwner && (!workerBranchId || order.currentBranchId !== workerBranchId)) {
        return { forbidden: true } as const;
      }
      if (!isOwner && data.movementType === "MANUAL_TRANSFER") {
        return { manualForbidden: true } as const;
      }

      // Guided worker handoffs never accept a caller-chosen destination.
      // CleanTrack derives the destination from the order's immutable route.
      // Owners may still supply a target for MANUAL_TRANSFER.
      if (!isOwner && data.toBranchId !== undefined) {
        return { workerTargetForbidden: true } as const;
      }
      const targetBranchId = isOwner && data.movementType === "MANUAL_TRANSFER"
        ? data.toBranchId
        : isOwner && data.movementType === "PROCESSING_TRANSFER" && data.toBranchId !== undefined
          ? data.toBranchId
          : data.movementType === "PROCESSING_TRANSFER"
            ? order.processingBranchId
            : data.movementType === "RETURN_TRANSFER"
              ? order.returnBranchId
              : null;
      if (targetBranchId == null) return { missingTarget: true } as const;

      const [target] = await tx.select({ id: branches.id, type: branches.type, name: branches.name })
        .from(branches)
        .where(and(eq(branches.id, targetBranchId), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)));
      if (!target) return { badBranch: true } as const;

      if (data.movementType === "PROCESSING_TRANSFER") {
        if (!["PROCESSING", "HYBRID"].includes(target.type)) return { badCapability: "processing" } as const;
        if (order.currentBranchId !== order.collectionBranchId) return { badSource: "processing" } as const;
        if (!["pending", "processing"].includes(order.status)) return { badStatus: "processing" } as const;
        // Collection verification belongs to the receiving processing branch.
        // The Pickup branch records the customer's intake count when the order is
        // created; it must not be blocked from handing the physical order off.

        // Owners may repair a legacy/broken processing route while moving the
        // order. Workers never choose destinations. A route repair is only
        // allowed when the stored processing branch is missing or no longer
        // processing-capable; valid configured routes remain immutable.
        if (data.toBranchId !== undefined) {
          if (!isOwner) return { workerTargetForbidden: true } as const;
          if (order.processingBranchId !== null) {
            const [configuredProcessingBranch] = await tx.select({ id: branches.id, type: branches.type })
              .from(branches)
              .where(and(
                eq(branches.id, order.processingBranchId),
                eq(branches.laundryId, laundryId),
                isNull(branches.deletedAt),
              ));
            if (configuredProcessingBranch && ["PROCESSING", "HYBRID"].includes(configuredProcessingBranch.type)) {
              return { routeOverrideForbidden: true } as const;
            }
          }
        } else {
          if (order.processingBranchId !== target.id) return { wrongTarget: "processing" } as const;
          if (order.collectionBranchId === order.processingBranchId) return { localProcessing: true } as const;
        }
      }

      if (data.movementType === "RETURN_TRANSFER") {
        if (order.returnBranchId !== target.id) return { wrongTarget: "return" } as const;
        if (!["PICKUP", "HYBRID"].includes(target.type)) return { badCapability: "return" } as const;
        if (order.currentBranchId !== order.processingBranchId) return { badSource: "return" } as const;
        if (order.returnBranchId === order.processingBranchId) return { localReturn: true } as const;
        if (!["ready", "partial_pickup"].includes(order.status)) return { badStatus: "return" } as const;
      }

      if (data.movementType === "MANUAL_TRANSFER" && !isOwner) return { manualForbidden: true } as const;
      if (target.id === order.currentBranchId) return { unchanged: true, order } as const;

      const routeRepair =
        isOwner &&
        data.movementType === "PROCESSING_TRANSFER" &&
        data.toBranchId !== undefined &&
        order.processingBranchId !== target.id;

      const [updated] = await tx.update(orders)
        .set({
          ...(routeRepair ? { processingBranchId: target.id } : {}),
          currentBranchId: target.id,
          assignedWorkerId: null,
          // Verification belongs to the branch currently holding the clothes.
          // The receiving branch must verify its own physical count.
          isVerified: false,
          verifiedShirts: null,
          verifiedTrousers: null,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, order.id), eq(orders.laundryId, laundryId)))
        .returning();

      const [movement] = await tx.insert(orderMovements).values({
        laundryId,
        orderId: order.id,
        fromBranchId: order.currentBranchId,
        toBranchId: target.id,
        movementType: data.movementType,
        reason: data.reason ?? null,
        movedByWorkerId: req.auth!.workerId ?? null,
        movedByType: req.auth!.type,
        movedByName: actorName(req.auth!),
      }).returning();

      return { order: updated, movement, routeRepaired: routeRepair } as const;
    });

    if ("notFound" in result) return res.status(404).json({ error: "Order not found" });
    if ("terminal" in result) return res.status(409).json({ error: "Completed or cancelled orders cannot be moved" });
    if ("forbidden" in result) return res.status(403).json({ error: "You can only move orders currently at your assigned branch" });
    if ("manualForbidden" in result || "workerTargetForbidden" in result) return res.status(403).json({ error: "Workers can only use the guided branch handoff actions; the destination is controlled by the order route" });
    if ("missingTarget" in result) return res.status(400).json({ error: "This order has no destination branch configured" });
    if ("badBranch" in result) return res.status(400).json({ error: "Target branch not found" });
    if ("wrongTarget" in result) return res.status(400).json({ error: "Target branch does not match the order lifecycle location" });
    if ("routeOverrideForbidden" in result) return res.status(409).json({ error: "The configured processing branch is valid. Reconfigure the branch network instead of overriding this order route." });
    if ("badCapability" in result) return res.status(400).json({ error: "Target branch does not support this operation" });
    if ("badSource" in result) return res.status(409).json({ error: "The order is not currently at the branch that should send it" });
    if ("badStatus" in result) return res.status(409).json({ error: "The order is not ready for this handoff" });
    if ("notVerified" in result) return res.status(409).json({ error: "Verify the clothes/count before sending the order to another branch", code: "ORDER_NOT_VERIFIED" });
    if ("localProcessing" in result || "localReturn" in result) return res.status(409).json({ error: "This order is already at its configured operating branch; no handoff is required" });

    if ("movement" in result && result.movement) {
      // The movement record is the source of truth. These notifications are
      // only an operational signal for the owner and receiving workers.
      try {
        const movement = result.movement;
        const [fromBranch, toBranch] = await Promise.all([
          movement.fromBranchId
            ? db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, movement.fromBranchId))
            : Promise.resolve([]),
          db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, movement.toBranchId)),
        ]);
        const fromName = fromBranch[0]?.name ?? "Previous branch";
        const toName = toBranch[0]?.name ?? "Destination branch";
        const workerPermissionField = movement.movementType === "PROCESSING_TRANSFER"
          ? workerPermissions.canProcessOrders
          : workerPermissions.canRecordPickups;

        const receivingWorkers = await db
          .select({ workerId: workers.id })
          .from(workers)
          .innerJoin(workerPermissions, eq(workerPermissions.workerId, workers.id))
          .where(and(
            eq(workers.laundryId, laundryId),
            eq(workers.branchId, movement.toBranchId),
            eq(workers.isActive, true),
            isNull(workers.deletedAt),
            eq(workerPermissionField, true),
          ));

        const notificationRows = [
          {
            laundryId,
            targetType: "owner" as const,
            eventType: "branch_handoff" as const,
            title: movement.movementType === "PROCESSING_TRANSFER" ? "Order Sent for Processing" : "Order Returned to Branch",
            message: `Order #${result.order.orderId} moved ${fromName} → ${toName}.`,
            severity: "info" as const,
            relatedOrderId: orderId,
          },
          ...receivingWorkers.map(({ workerId }) => ({
            laundryId,
            targetType: "worker" as const,
            targetWorkerId: workerId,
            eventType: "branch_handoff" as const,
            title: movement.movementType === "PROCESSING_TRANSFER" ? "Incoming Order for Processing" : "Order Returned to Your Branch",
            message: movement.movementType === "PROCESSING_TRANSFER"
              ? `Order #${result.order.orderId} has arrived from ${fromName} for processing.`
              : `Order #${result.order.orderId} has returned from ${fromName} and is ready for pickup handling.`,
            severity: "info" as const,
            relatedOrderId: orderId,
          })),
        ];

        await db.insert(notifications).values(notificationRows);
      } catch (notificationErr) {
        console.error("[order-move] Failed to create branch handoff notifications:", notificationErr);
      }

      logAction({
        auth: req.auth!,
        laundryId,
        action: "order_branch_moved",
        orderId,
        metadata: {
          movementId: result.movement.id,
          movementType: result.movement.movementType,
          fromBranchId: result.movement.fromBranchId,
          toBranchId: result.movement.toBranchId,
          reason: result.movement.reason,
          movedBy: result.movement.movedByName,
        },
      }).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error("[order-move]", err);
    res.status(500).json({ error: "Failed to move order" });
  }
});
ordersRouter.patch("/:id", idempotencyMiddleware, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const isOwner = req.auth!.type === "owner";
    const workerBranchId = req.auth!.branchId;

    // Workers cannot touch any pricing fields — check before Zod strips them
    if (!isOwner) {
      const priceFields = ["price", "extraCharge", "discount"];
      const forbidden = priceFields.filter(f => f in req.body);
      if (forbidden.length > 0) {
        return res.status(403).json({
          error: "Permission denied",
          hint: `Workers cannot modify pricing fields: ${forbidden.join(", ")}. Use the discount request system instead.`,
        });
      }
      // A worker may receive/claim an order for themselves without assign:orders.
      // assign:orders is only required when assigning the order to another worker.
      if ("assignedWorkerId" in req.body) {
        const requestedWorkerId = req.body.assignedWorkerId;
        const isSelfAssignment =
          requestedWorkerId !== null &&
          requestedWorkerId !== undefined &&
          requestedWorkerId === req.auth!.workerId;
        if (!isSelfAssignment && !req.auth!.permissions?.canAssignOrders) {
          return res.status(403).json({
            error: "Permission denied",
            required: "assign:orders",
            hint: "You can receive/claim orders for yourself. Assigning them to another worker requires assignment permission.",
          });
        }
      }
    }

    if ("paymentStatus" in req.body) {
      return res.status(400).json({ error: "paymentStatus is derived from recorded payments and cannot be edited directly" });
    }

    const data = isOwner
      ? ownerOrderUpdateSchema.parse(req.body)
      : workerOrderUpdateSchema.parse(req.body);

    // Pickup workers may receive/verify/handoff without gaining processing
    // permission. Processing state changes remain restricted to processing-capable
    // workers and are additionally checked against the order's current branch.
    if (!isOwner && !req.auth!.permissions?.canRecordPickups && !req.auth!.permissions?.canProcessOrders) {
      return res.status(403).json({ error: "You do not have permission to operate orders" });
    }

    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };

    if (isOwner) {
      if ((data as any).price !== undefined) updateData.price = (data as any).price?.toString();
      if ((data as any).extraCharge !== undefined) updateData.extraCharge = (data as any).extraCharge?.toString();
      if ((data as any).discount !== undefined) updateData.discount = (data as any).discount?.toString();
    }

    const patchConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) patchConditions.push(eq(orders.currentBranchId, workerBranchId));

    const [beforeOrder] = await db.select().from(orders).where(and(...patchConditions));
    if (!beforeOrder) return res.status(404).json({ error: "Order not found" });

    // Terminal orders are immutable through the general PATCH endpoint.
    // Financial corrections/refunds and pickup completion have their own audited workflows.
    if (beforeOrder.status === "completed" || beforeOrder.status === "cancelled") {
      return res.status(409).json({
        error: "Completed or cancelled orders are read-only. Use the audited correction/refund workflow for exceptional changes.",
        code: "TERMINAL_ORDER_READ_ONLY",
      });
    }

    // Cross-branch verification belongs to the receiving processing branch.
    // Pickup intake is the customer's declared/collection count; the processing
    // branch establishes the physical receiving count before processing begins.
    if (data.isVerified === true && beforeOrder.collectionBranchId !== beforeOrder.processingBranchId) {
      const [verificationBranch] = await db.select({ id: branches.id, type: branches.type })
        .from(branches)
        .where(and(
          eq(branches.id, beforeOrder.currentBranchId ?? -1),
          eq(branches.laundryId, laundryId),
          isNull(branches.deletedAt),
        ));
      const canVerifyHere = !!verificationBranch && ["PROCESSING", "HYBRID"].includes(verificationBranch.type)
        && beforeOrder.currentBranchId === beforeOrder.processingBranchId;
      if (!canVerifyHere) {
        return res.status(409).json({
          error: "Cross-branch orders must be received and verified at the configured processing branch",
          code: "PROCESSING_RECEIPT_VERIFICATION_REQUIRED",
        });
      }
    }

    // Processing state can only be changed while the physical order is at
    // its configured processing branch. A Pickup branch may receive/verify/send,
    // but it can never turn an order into "processing" or "ready".
    if (data.status === "processing" || data.status === "ready") {
      if (!isOwner && !req.auth!.permissions?.canProcessOrders) {
        return res.status(403).json({ error: "Processing permission is required to process or mark an order ready" });
      }
      const [currentBranch] = await db.select({ id: branches.id, type: branches.type })
        .from(branches)
        .where(and(eq(branches.id, beforeOrder.currentBranchId ?? -1), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)));
      const canProcessHere = !!currentBranch && ["PROCESSING", "HYBRID"].includes(currentBranch.type);
      if (!canProcessHere || beforeOrder.currentBranchId !== beforeOrder.processingBranchId) {
        return res.status(409).json({
          error: "This order is not at a processing-capable branch",
          code: "PROCESSING_BRANCH_REQUIRED",
        });
      }
      if (data.status === "processing" && data.isVerified !== true && beforeOrder.isVerified !== true) {
        return res.status(409).json({
          error: "Receive and verify the order at the processing branch before processing it",
          code: "PROCESSING_RECEIPT_VERIFICATION_REQUIRED",
        });
      }
    }

    if (isOwner) {
      const nextPrice = (data as any).price !== undefined ? (data as any).price : parseFloat(beforeOrder.price || "0");
      const nextExtra = (data as any).extraCharge !== undefined ? (data as any).extraCharge : parseFloat(beforeOrder.extraCharge || "0");
      const nextDiscount = (data as any).discount !== undefined ? (data as any).discount : parseFloat(beforeOrder.discount || "0");
      if (nextPrice + nextExtra - nextDiscount < 0) return res.status(400).json({ error: "Discount cannot exceed the order subtotal plus extra charge" });
    }

    // ── Status transition validation ──────────────────────────────────────
    // Enforce the state machine before touching the database.
    // This applies equally to owners and workers — no role bypasses the rules.
    if (data.status !== undefined && beforeOrder && data.status !== beforeOrder.status) {
      const currentStatus = beforeOrder.status;
      const allowedNext = VALID_STATUS_TRANSITIONS[currentStatus] ?? [];
      if (!allowedNext.includes(data.status)) {
        const reason = allowedNext.length > 0
          ? `Allowed next statuses from '${currentStatus}': ${allowedNext.join(", ")}.`
          : `'${currentStatus}' is a terminal or read-only status — it cannot be changed via this endpoint.`;
        return res.status(409).json({
          error: `Cannot move order from '${currentStatus}' to '${data.status}'. ${reason}`,
          code: "INVALID_STATUS_TRANSITION",
          from: currentStatus,
          to: data.status,
          allowed: allowedNext,
        });
      }
    }

    if ("assignedWorkerId" in req.body && data.assignedWorkerId !== null && data.assignedWorkerId !== undefined) {
      // A worker may claim/receive an order for themselves without the broader
      // assign:orders permission. That permission is only required when they
      // assign an order to someone else.
      const isSelfAssignment = !isOwner && data.assignedWorkerId === req.auth!.workerId;
      if (!isSelfAssignment && !req.auth!.permissions?.canAssignOrders) {
        return res.status(403).json({
          error: "Permission denied",
          required: "assign:orders",
          hint: "You can claim/receive orders for yourself, but assigning them to another worker requires assignment permission.",
        });
      }

      const [targetWorker] = await db.select({ id: workers.id, laundryId: workers.laundryId, branchId: workers.branchId }).from(workers).where(eq(workers.id, data.assignedWorkerId));
      if (!targetWorker || targetWorker.laundryId !== laundryId) return res.status(403).json({ error: "Assigned worker does not belong to this laundry" });
      const workerAssignmentBranch = beforeOrder.currentBranchId ?? beforeOrder.processingBranchId ?? beforeOrder.collectionBranchId;
      if (workerAssignmentBranch !== null && targetWorker.branchId !== workerAssignmentBranch) {
        return res.status(400).json({ error: "Assigned worker must belong to the order's current operating branch" });
      }
      if (workerBranchId && targetWorker.branchId !== workerBranchId) return res.status(403).json({ error: "Workers can only assign orders to workers in their branch" });
    }

    const [order] = await db.update(orders).set(updateData)
      .where(and(...patchConditions))
      .returning();
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Record physical receipt only after the custody assignment was persisted.
    if (
      !isOwner &&
      data.assignedWorkerId === req.auth!.workerId &&
      beforeOrder.currentBranchId === beforeOrder.processingBranchId &&
      beforeOrder.collectionBranchId !== beforeOrder.processingBranchId &&
      beforeOrder.assignedWorkerId !== req.auth!.workerId
    ) {
      logAction({
        auth: req.auth!,
        laundryId,
        action: "order_branch_received",
        orderId: order.id,
        metadata: {
          branchId: order.currentBranchId,
          processingBranchId: order.processingBranchId,
          collectionBranchId: order.collectionBranchId,
          receivedByWorkerId: req.auth!.workerId,
          receivedByName: req.auth!.name,
        },
      }).catch(() => {});
    }

    if (beforeOrder) {
      if (data.status === "processing" && beforeOrder.status !== "processing") {
        emitEvent({
          laundryId,
          eventType: "order_processing",
          title: "Order Now Processing",
          message: `Order #${order.orderId} for ${order.customerName} is now being processed.`,
          severity: "info",
          relatedOrderId: order.id,
        }).catch(() => {});
      }

      if (data.status === "ready" && beforeOrder.status !== "ready") {
        emitEvent({
          laundryId,
          eventType: "order_ready",
          title: "Order Ready for Pickup",
          message: `Order #${order.orderId} for ${order.customerName} is ready for pickup.`,
          severity: "success",
          relatedOrderId: order.id,
        }).catch(() => {});

        fireAutomation({
          laundryId,
          triggerEvent: "ORDER_READY",
          customerName: order.customerName,
          customerPhone: order.phone,
          orderId: order.orderId,
        }).catch(() => {});
      }

      if (data.status === "completed" && beforeOrder.status !== "completed") {
        trackActivationEvent(laundryId, "order_completed");

        fireAutomation({
          laundryId,
          triggerEvent: "ORDER_COMPLETED",
          customerName: order.customerName,
          customerPhone: order.phone,
          orderId: order.orderId,
        }).catch(() => {});
      }

      if (data.assignedWorkerId && data.assignedWorkerId !== beforeOrder.assignedWorkerId) {
        emitEvent({
          laundryId,
          targetType: "worker",
          targetWorkerId: data.assignedWorkerId,
          eventType: "order_assigned",
          title: "Order Assigned to You",
          message: `Order #${order.orderId} for ${order.customerName} has been assigned to you.`,
          severity: "info",
          relatedOrderId: order.id,
        }).catch(() => {});
      }
    }

    logAction({
      auth: req.auth!,
      laundryId,
      action: "order_updated",
      orderId: order.id,
      metadata: { changes: data, orderId: order.orderId },
    }).catch(() => {});

    res.json(order);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update order" });
  }
});

ordersRouter.delete("/:id", checkPermission("delete:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const orderId = parseInt(req.params.id);
    const conditions: any[] = [eq(orders.id, orderId), eq(orders.laundryId, laundryId)];
    if (workerBranchId) conditions.push(eq(orders.currentBranchId, workerBranchId));

    const [existing] = await db.select().from(orders).where(and(...conditions));
    if (!existing) return res.status(404).json({ error: "Order not found" });

    if (existing.status !== "pending" && existing.status !== "processing") {
      return res.status(409).json({
        error: "Only pending or processing orders can be cancelled.",
        code: "INVALID_CANCELLATION_STATE",
        status: existing.status,
      });
    }

    const [cancelled] = await db.update(orders).set({
      status: "cancelled",
      updatedAt: new Date(),
    }).where(and(...conditions)).returning();

    logAction({
      auth: req.auth!,
      laundryId,
      action: "order_cancelled",
      orderId: cancelled.id,
      metadata: { orderId: cancelled.orderId, customerName: cancelled.customerName, previousStatus: existing.status },
    }).catch(() => {});

    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete order" });
  }
});

ordersRouter.get("/:id/payments", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const pmtConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) pmtConditions.push(eq(orders.currentBranchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...pmtConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });
    const payments = await db.select().from(paymentRecords)
      .where(eq(paymentRecords.orderId, order.id))
      .orderBy(desc(paymentRecords.recordedAt));
    res.json(payments);
  } catch {
    res.status(500).json({ error: "Failed to list payments" });
  }
});

ordersRouter.post("/:id/payments", checkPermission("record:payments"), idempotencyMiddleware, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const paymentSchema = z.object({
      amount: z.number().min(0.01),
      method: z.enum(["cash", "transfer", "pos"]).default("cash"),
      notes: z.string().optional(),
      reference: z.string().trim().max(120).optional(),
      attachmentUrl: z.string().trim().max(2000).optional(),
      // Set by the client after the user explicitly dismisses a duplicate-payment warning.
      confirmDuplicate: z.boolean().optional(),
    });
    const data = paymentSchema.parse(req.body);
    const orderId = parseInt(req.params.id);

    // ── Duplicate-payment detection ─────────────────────────────────────────
    // Manual reconciliation has no provider to verify against, so this is a
    // heuristic *warning*, never a hard block: staff can always confirm and
    // proceed (e.g. a customer genuinely paying the same amount twice).
    const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
    const recentSameOrderPayments = await db.select().from(paymentRecords).where(and(
      eq(paymentRecords.orderId, orderId),
      isNull(paymentRecords.deletedAt),
    ));
    const now = Date.now();
    const exactMatch = recentSameOrderPayments.find(p =>
      parseFloat(p.amount) === data.amount &&
      p.method === data.method &&
      now - new Date(p.recordedAt).getTime() <= DUPLICATE_WINDOW_MS
    );
    const looseMatch = !exactMatch && recentSameOrderPayments.find(p =>
      parseFloat(p.amount) === data.amount &&
      now - new Date(p.recordedAt).getTime() <= 30 * 60 * 1000
    );

    if (exactMatch && !data.confirmDuplicate) {
      return res.status(409).json({
        duplicateWarning: true,
        reasons: ["same_amount_and_method_within_5_minutes"],
        existingPayment: {
          id: exactMatch.id,
          amount: exactMatch.amount,
          method: exactMatch.method,
          recordedAt: exactMatch.recordedAt,
          recordedBy: exactMatch.recordedBy,
          receiptNumber: exactMatch.receiptNumber,
        },
        message: "A payment with the same amount and method was just recorded on this order. Confirm to record it anyway.",
      });
    }

    const confidenceScore: "high" | "medium" | "low" = exactMatch ? "low" : looseMatch ? "medium" : "high";
    const confidenceReasons: string[] = exactMatch
      ? ["same_amount_and_method_within_5_minutes_confirmed_by_staff"]
      : looseMatch
      ? ["same_amount_recorded_within_30_minutes"]
      : [];

    /**
     * All financial mutations run inside a single serialisable transaction with
     * a row-level lock (SELECT … FOR UPDATE) on the target order row.
     *
     * Without this lock two concurrent payment requests can both read the same
     * stale `amount_paid`, both compute their own `newAmountPaid`, and both
     * UPDATE the order — the second write silently overwrites the first,
     * effectively losing one payment from the running balance.
     *
     * The FOR UPDATE lock ensures only one writer at a time advances the
     * balance for a given order, regardless of how many Node processes or
     * concurrent workers are involved.
     *
     * Receipt number generation also happens inside the same transaction so
     * that a rolled-back payment does not consume a counter slot.
     */
    const txResult = await db.transaction(async (tx) => {
      const branchClause = workerBranchId
        ? sql` AND current_branch_id = ${workerBranchId}`
        : sql``;
      const lockResult = await tx.execute(
        sql`SELECT id, order_id, customer_name, branch_id, current_branch_id, price, extra_charge,
                   discount, amount_paid, payment_status, status,
                   shirts, trousers, shirts_picked_up, trousers_picked_up
            FROM orders
            WHERE id = ${orderId} AND laundry_id = ${laundryId}${branchClause}
            FOR UPDATE`
      );
      const row = (lockResult as any).rows?.[0];
      if (!row) return null;

      const price = parseFloat(row.price || "0");
      const extraCharge = parseFloat(row.extra_charge || "0");
      const discount = parseFloat(row.discount || "0");
      const totalDue = price + extraCharge - discount;
      const newAmountPaid = parseFloat(row.amount_paid || "0") + data.amount;
      const remainingBalance = Math.max(0, totalDue - newAmountPaid);
      const paymentStatus: string =
        remainingBalance <= 0 ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid";

      const receiptNumber = await generateReceiptNumber(tx as unknown as typeof db);

      const [payment] = await tx.insert(paymentRecords).values({
        orderId: row.id,
        laundryId,
        branchId: row.branch_id ?? undefined,
        receiptNumber,
        amount: data.amount.toString(),
        method: data.method,
        notes: data.notes,
        remainingBalance: remainingBalance.toString(),
        recordedBy: actorName(req.auth!),
        workerId: req.auth!.type === "worker" ? (req.auth!.workerId ?? null) : null,
        reference: data.reference || (row.order_id as string),
        attachmentUrl: data.attachmentUrl,
        provider: "manual",
        reconciliationStatus: "confirmed",
        confidenceScore,
        confidenceReasons,
      }).returning();

      await tx.update(orders).set({
        amountPaid: newAmountPaid.toString(),
        paymentStatus,
        updatedAt: new Date(),
      }).where(eq(orders.id, row.id));

      // Auto-complete: if this payment fully settles an order that is already
      // in partial_pickup with all items already physically collected, transition
      // to completed inside the same transaction (avoids the deadlock where
      // pickup route can't re-trigger because no items remain to pick up).
      let autoCompleted = false;
      if (paymentStatus === "paid" && row.status === "partial_pickup") {
        const allOrderItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, row.id));
        let allPickedUp = false;
        if (allOrderItems.length > 0) {
          // Item-based tracking: every item must be fully collected
          allPickedUp = allOrderItems.every(oi => oi.quantityPickedUp >= oi.quantity);
        } else {
          // Legacy tracking: shirts and trousers counters must match totals
          const shirtsTotal = (row.shirts as number) ?? 0;
          const trousersTotal = (row.trousers as number) ?? 0;
          const shirtsPickedUp = (row.shirts_picked_up as number) ?? 0;
          const trousersPickedUp = (row.trousers_picked_up as number) ?? 0;
          allPickedUp = shirtsPickedUp >= shirtsTotal && trousersPickedUp >= trousersTotal;
        }
        if (allPickedUp) {
          await tx.update(orders).set({ status: "completed", updatedAt: new Date() })
            .where(eq(orders.id, row.id));
          autoCompleted = true;
        }
      }

      return {
        payment,
        orderId: row.id,
        orderRef: row.order_id as string,
        customerName: row.customer_name as string,
        remainingBalance,
        paymentStatus,
        autoCompleted,
      };
    });

    if (!txResult) return res.status(404).json({ error: "Order not found" });

    const { payment, orderId: oId, orderRef, customerName, remainingBalance, paymentStatus, autoCompleted } = txResult;

    emitEvent({
      laundryId,
      eventType: "payment_received",
      title: "Payment Received",
      message: `₦${data.amount.toLocaleString()} received for Order #${orderRef} (${customerName}) via ${data.method}. Balance: ₦${remainingBalance.toLocaleString()}.`,
      severity: remainingBalance <= 0 ? "success" : "info",
      relatedOrderId: oId,
    }).catch(() => {});

    // If payment completion triggered an auto-complete of a fully-picked-up order, emit the completion event.
    if (autoCompleted) {
      emitEvent({
        laundryId,
        eventType: "pickup_completed",
        title: "Order Completed",
        message: `Order #${orderRef} for ${customerName} — fully paid and all items already collected. Order auto-completed.`,
        severity: "success",
        relatedOrderId: oId,
      }).catch(() => {});

      logAction({
        auth: req.auth!,
        laundryId,
        action: "order_auto_completed",
        orderId: oId,
        metadata: { orderId: orderRef, trigger: "payment_settled_after_full_pickup" },
      }).catch(() => {});
    }

    trackActivationEvent(laundryId, "payment_recorded");

    logAction({
      auth: req.auth!,
      laundryId,
      action: "payment_recorded",
      orderId: oId,
      metadata: {
        amount: data.amount,
        method: data.method,
        remainingBalance,
        paymentStatus,
        orderId: orderRef,
        autoCompleted: autoCompleted ?? false,
      },
    }).catch(() => {});

    // Fire automation (fire-and-forget, non-blocking)
    db.select({ phone: orders.phone }).from(orders).where(eq(orders.id, oId))
      .then(([o]) => {
        if (!o?.phone) return Promise.resolve();
        return fireAutomation({
          laundryId,
          triggerEvent: "PAYMENT_RECEIVED",
          customerName,
          customerPhone: o.phone,
          orderId: orderRef,
        });
      })
      .catch(() => {});

    res.status(201).json(payment);
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error("[payment record] err:", err?.message, err?.code);
    res.status(500).json({ error: "Failed to record payment" });
  }
});

ordersRouter.delete("/:id/payments/:paymentId", checkPermission("delete:payments"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const orderId = parseInt(req.params.id, 10);
    const paymentId = parseInt(req.params.paymentId, 10);
    if (!Number.isInteger(orderId) || !Number.isInteger(paymentId)) {
      return res.status(400).json({ error: "Invalid order or payment ID" });
    }

    const txResult = await db.transaction(async (tx) => {
      const conditions: any[] = [eq(orders.id, orderId), eq(orders.laundryId, laundryId)];
      if (workerBranchId) conditions.push(eq(orders.currentBranchId, workerBranchId));

      const [order] = await tx.select().from(orders).where(and(...conditions)).for("update");
      if (!order) return { notFound: true } as const;
      if (order.status === "completed" || order.status === "cancelled") return { terminal: true } as const;

      const [existing] = await tx.select().from(paymentRecords)
        .where(and(eq(paymentRecords.id, paymentId), eq(paymentRecords.orderId, order.id)));

      if (!existing || existing.deletedAt) return { paymentNotFound: true } as const;

      const auth = req.auth!;
      await tx.update(paymentRecords).set({
        deletedAt: new Date(),
        deletedById: auth.type === "owner" ? (auth.ownerId ?? null) : (auth.workerId ?? null),
        deletedByType: auth.type,
        deletedByName: auth.name ?? auth.email ?? "unknown",
      }).where(eq(paymentRecords.id, paymentId));

      const remaining = await tx.select().from(paymentRecords)
        .where(and(eq(paymentRecords.orderId, order.id), isNull(paymentRecords.deletedAt)));

      const newAmountPaid = remaining.reduce((sum, p) => sum + parseFloat(p.amount), 0);
      const totalDue = parseFloat(order.price || "0") + parseFloat(order.extraCharge || "0") - parseFloat(order.discount || "0");
      const newPaymentStatus = totalDue <= 0 || newAmountPaid >= totalDue
        ? "paid"
        : newAmountPaid > 0
          ? "partial"
          : "unpaid";

      await tx.update(orders).set({
        amountPaid: newAmountPaid.toString(),
        paymentStatus: newPaymentStatus,
        updatedAt: new Date(),
      }).where(eq(orders.id, order.id));

      return {
        existing,
        newAmountPaid,
        newPaymentStatus,
        orderRef: order.orderId,
      } as const;
    });

    if ("notFound" in txResult) return res.status(404).json({ error: "Order not found" });
    if ("terminal" in txResult) return res.status(409).json({ error: "Payments on completed or cancelled orders require an audited correction or refund workflow." });
    if ("paymentNotFound" in txResult) return res.status(404).json({ error: "Payment not found" });

    logAction({
      auth: req.auth!,
      laundryId,
      action: "payment_voided",
      orderId,
      metadata: {
        paymentId,
        receiptNumber: txResult.existing.receiptNumber,
        amount: txResult.existing.amount,
        newAmountPaid: txResult.newAmountPaid,
        newPaymentStatus: txResult.newPaymentStatus,
        orderId: txResult.orderRef,
      },
    }).catch(() => {});

    res.status(204).send();
  } catch (err) {
    console.error("[payment void] err:", err);
    res.status(500).json({ error: "Failed to void payment" });
  }
});

ordersRouter.get("/:id/items", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const itemsGetConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) itemsGetConditions.push(eq(orders.currentBranchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...itemsGetConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    res.json(items);
  } catch {
    res.status(500).json({ error: "Failed to list order items" });
  }
});

ordersRouter.post("/:id/items", checkPermission("modify:order-items"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const itemsSchema = z.object({
      items: z.array(z.object({
        serviceId: z.number().int().optional(),
        serviceType: z.enum(["standard", "express", "premium"]),
        name: z.string().min(1),
        quantity: z.number().int().min(1),
        unitPrice: z.number().min(0),
      })).min(1),
    });
    const data = itemsSchema.parse(req.body);
    const itemsPostConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) itemsPostConditions.push(eq(orders.currentBranchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...itemsPostConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

    await db.delete(orderItems).where(eq(orderItems.orderId, order.id));

    const newItems = data.items.map(item => ({
      orderId: order.id,
      serviceId: item.serviceId,
      serviceType: item.serviceType,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      totalPrice: (item.quantity * item.unitPrice).toString(),
    }));

    await db.insert(orderItems).values(newItems);

    const totalPrice = newItems.reduce((sum, i) => sum + parseFloat(i.totalPrice), 0);
    const [updated] = await db.update(orders).set({
      price: totalPrice.toString(),
      updatedAt: new Date(),
    }).where(eq(orders.id, order.id)).returning();

    logAction({
      auth: req.auth!,
      laundryId,
      action: "order_items_updated",
      orderId: order.id,
      metadata: { newTotal: totalPrice, itemCount: data.items.length, orderId: order.orderId },
    }).catch(() => {});

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    res.json({ ...updated, items });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to add order items" });
  }
});

ordersRouter.get("/:id/receipt", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const receiptConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) receiptConditions.push(eq(orders.currentBranchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...receiptConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const [laundry] = await db.select().from(laundries).where(eq(laundries.id, laundryId));
    const [customer] = order.customerId
      ? await db.select().from(customers).where(eq(customers.id, order.customerId))
      : [null];

    const [items, adjustments, allPayments] = await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
      db.select().from(priceAdjustments).where(eq(priceAdjustments.orderId, order.id)).orderBy(priceAdjustments.createdAt),
      db.select().from(paymentRecords).where(eq(paymentRecords.orderId, order.id)).orderBy(paymentRecords.recordedAt),
    ]);

    const latestPayment = allPayments.length > 0 ? allPayments[allPayments.length - 1] : null;

    const [orderBranch, cashierWorker] = await Promise.all([
      order.currentBranchId
        ? db.select().from(branches).where(eq(branches.id, order.currentBranchId)).then(r => r[0] ?? null)
        : Promise.resolve(null),
      latestPayment?.workerId
        ? db.select({ name: workers.name }).from(workers).where(eq(workers.id, latestPayment.workerId)).then(r => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    const businessProfile = (laundry?.businessProfile ?? {}) as Record<string, string>;
    const brandingSettings = (laundry?.brandingSettings ?? {}) as Record<string, string>;

    const { basePrice, extraCharge, discount, totalDue, amountPaid, balance, isCancelled } = computeOrderPricing(order);

    res.json({
      receipt: latestPayment ? {
        receiptNumber: latestPayment.receiptNumber,
        recordedAt: latestPayment.recordedAt,
        amount: parseFloat(latestPayment.amount),
        method: latestPayment.method,
        notes: latestPayment.notes,
        remainingBalance: parseFloat(latestPayment.remainingBalance),
        recordedBy: latestPayment.recordedBy,
        cashierName: cashierWorker?.name ?? latestPayment.recordedBy ?? null,
      } : null,
      laundry: {
        businessName: laundry?.businessName ?? "",
        phone: laundry?.phone ?? "",
        address: businessProfile.address ?? "",
        email: businessProfile.email ?? "",
        website: (businessProfile as any).website ?? "",
        logoUrl: businessProfile.logoUrl ?? "",
        receiptHeaderName: brandingSettings.receiptHeaderName ?? laundry?.businessName ?? "",
        receiptFooterText: brandingSettings.receiptFooterText ?? "",
        brandColor: brandingSettings.brandColor ?? "",
        paymentDetails: (businessProfile as any).paymentDetails ?? null,
      },
      branch: orderBranch ? {
        id: orderBranch.id,
        name: orderBranch.name,
        address: orderBranch.address ?? "",
      } : null,
      customer: {
        fullName: order.customerName,
        phone: order.phone,
        address: order.address ?? customer?.address ?? "",
      },
      order: {
        id: order.id,
        orderId: order.orderId,
        branchId: order.currentBranchId,
        serviceType: order.serviceType,
        shirts: order.shirts,
        trousers: order.trousers,
        status: order.status,
        paymentStatus: order.paymentStatus,
        additionalNotes: order.additionalNotes,
        createdAt: order.createdAt,
      },
      items,
      priceAdjustments: adjustments,
      pricing: {
        basePrice,
        extraCharge,
        discount,
        totalDue,
        amountPaid,
        balance,
        isCancelled,
      },
      allPayments: allPayments.map(p => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        amount: parseFloat(p.amount),
        method: p.method,
        recordedBy: p.recordedBy,
        recordedAt: p.recordedAt,
        remainingBalance: parseFloat(p.remainingBalance),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get receipt" });
  }
});

ordersRouter.get("/:id/audit-log", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const auditConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) auditConditions.push(eq(orders.currentBranchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...auditConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });
    const entries = await db.select().from(auditLog)
      .where(and(eq(auditLog.orderId, order.id), eq(auditLog.laundryId, laundryId)))
      .orderBy(desc(auditLog.createdAt));
    res.json(entries);
  } catch {
    res.status(500).json({ error: "Failed to get order timeline" });
  }
});

ordersRouter.get("/:id/price-adjustments", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const paGetConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) paGetConditions.push(eq(orders.currentBranchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...paGetConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });
    const adjustments = await db.select().from(priceAdjustments)
      .where(eq(priceAdjustments.orderId, order.id))
      .orderBy(priceAdjustments.createdAt);
    res.json(adjustments);
  } catch {
    res.status(500).json({ error: "Failed to list price adjustments" });
  }
});

ordersRouter.post("/:id/price-adjustments", checkPermission("process:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const isOwner = req.auth!.type === "owner";
    const workerBranchId = req.auth!.branchId;

    const schema = z.object({
      type: z.enum(["discount", "extra_charge"]),
      amount: z.number().positive(),
      reason: z.string().min(1, "Reason is required"),
    });
    const data = schema.parse(req.body);

    // Workers cannot add surcharges — only owners can
    if (!isOwner && data.type === "extra_charge") {
      return res.status(403).json({
        error: "Permission denied",
        hint: "Workers cannot add surcharges. Contact the owner to add extra charges.",
      });
    }

    const paPostConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) paPostConditions.push(eq(orders.currentBranchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...paPostConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const appliedBy = actorName(req.auth!);

    // Owner: always direct apply
    if (isOwner) {
      const [adjustment] = await db.insert(priceAdjustments).values({
        orderId: order.id,
        laundryId,
        type: data.type,
        amount: data.amount.toString(),
        reason: data.reason,
        appliedBy,
      }).returning();

      const currentDiscount = parseFloat(order.discount || "0");
      const currentExtraCharge = parseFloat(order.extraCharge || "0");

      if (data.type === "discount") {
        await db.update(orders).set({
          discount: (currentDiscount + data.amount).toString(),
          updatedAt: new Date(),
        }).where(eq(orders.id, order.id));
      } else {
        await db.update(orders).set({
          extraCharge: (currentExtraCharge + data.amount).toString(),
          updatedAt: new Date(),
        }).where(eq(orders.id, order.id));
      }

      logAction({
        auth: req.auth!,
        laundryId,
        action: data.type === "discount" ? "discount_applied" : "surcharge_applied",
        orderId: order.id,
        metadata: { amount: data.amount, reason: data.reason, type: data.type, orderId: order.orderId },
      }).catch(() => {});

      return res.status(201).json(adjustment);
    }

    // Worker requesting a discount — check against laundry discount rules
    const [laundry] = await db.select({ discountSettings: laundries.discountSettings })
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    const settings = (laundry?.discountSettings ?? {}) as {
      maxDiscountPerOrder?: number;
      maxDiscountPercentage?: number;
      autoApprovalThreshold?: number;
    };

    const orderPrice = parseFloat(order.price || "0");
    const maxAbs = settings.maxDiscountPerOrder ?? 0;
    const maxPct = settings.maxDiscountPercentage ?? 0;
    const autoThreshold = settings.autoApprovalThreshold ?? 0;

    const withinAbsLimit = maxAbs === 0 || data.amount <= maxAbs;
    const withinPctLimit = maxPct === 0 || data.amount <= (orderPrice * maxPct / 100);
    const withinLimits = withinAbsLimit && withinPctLimit;
    const autoApprove = autoThreshold > 0 && data.amount <= autoThreshold && withinLimits;

    if (autoApprove) {
      // Auto-apply within configured threshold
      const [adjustment] = await db.insert(priceAdjustments).values({
        orderId: order.id,
        laundryId,
        type: "discount",
        amount: data.amount.toString(),
        reason: data.reason,
        appliedBy,
      }).returning();

      const currentDiscount = parseFloat(order.discount || "0");
      await db.update(orders).set({
        discount: (currentDiscount + data.amount).toString(),
        updatedAt: new Date(),
      }).where(eq(orders.id, order.id));

      logAction({
        auth: req.auth!,
        laundryId,
        action: "discount_auto_applied",
        orderId: order.id,
        metadata: {
          amount: data.amount,
          reason: data.reason,
          autoThreshold,
          orderId: order.orderId,
        },
      }).catch(() => {});

      return res.status(201).json({ ...adjustment, status: "auto_applied" });
    }

    // Exceeds auto-approval threshold or limits — create pending approval request
    const [approval] = await db.insert(discountApprovals).values({
      laundryId,
      orderId: order.id,
      requestedBy: req.auth!.workerId ?? null,
      requestedByName: appliedBy,
      originalAmount: orderPrice.toString(),
      requestedDiscount: data.amount.toString(),
      reason: data.reason,
      status: "pending",
    }).returning();

    emitEvent({
      laundryId,
      eventType: "discount_requested",
      title: "Discount Approval Required",
      message: `${appliedBy} requested ₦${data.amount.toLocaleString()} discount on Order #${order.orderId} (${order.customerName}). Reason: ${data.reason}`,
      severity: "warning",
      relatedOrderId: order.id,
    }).catch(() => {});

    logAction({
      auth: req.auth!,
      laundryId,
      action: "discount_requested",
      orderId: order.id,
      metadata: {
        amount: data.amount,
        reason: data.reason,
        withinLimits,
        approvalId: approval.id,
        orderId: order.orderId,
      },
    }).catch(() => {});

    return res.status(202).json({
      status: "pending_approval",
      message: "Discount request submitted. Awaiting owner approval.",
      approval,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to process price adjustment" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// WORKER OPERATIONAL MESSAGING — no access to templates/providers/billing
// ═══════════════════════════════════════════════════════════════════════════

// POST /orders/:id/send-notification  — trigger ready|reminder notification
// Accessible by workers with canProcessOrders permission
ordersRouter.post(
  "/:id/send-notification",
  checkPermission("process:orders"),
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const orderId = parseInt(req.params.id);
      const { type } = req.body as { type?: string };

      if (!type || !["ready", "reminder"].includes(type)) {
        return res.status(400).json({ error: "type must be 'ready' or 'reminder'" });
      }

      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.laundryId, laundryId)));

      if (!order) return res.status(404).json({ error: "Order not found" });
      if (!order.phone) return res.status(400).json({ error: "Order has no customer phone number" });

      // Fetch branch + laundry for variable interpolation
      const [laundry] = await db.select().from(laundries).where(eq(laundries.id, laundryId));
      const branchName = order.currentBranchId
        ? ((await db.select({ name: branches.name }).from(branches).where(eq(branches.id, order.currentBranchId)))[0]?.name ?? "Main Branch")
        : "Main Branch";

      const totalDue = Number(order.price ?? 0) + Number(order.extraCharge ?? 0) - Number(order.discount ?? 0);
      const amountPaid = Number(order.amountPaid ?? 0);
      const balance = Math.max(0, totalDue - amountPaid);

      const paymentDetails = (laundry?.businessProfile as any)?.paymentDetails ?? {};
      const vars = buildOrderVariables({
        customerName: order.customerName,
        orderNumber: order.orderId,
        branchName,
        businessName: laundry?.businessName ?? "CleanTrack",
        serviceType: order.serviceType,
        totalDue: `₦${totalDue.toLocaleString()}`,
        amountPaid: `₦${amountPaid.toLocaleString()}`,
        balance: `₦${balance.toLocaleString()}`,
        bankName: paymentDetails.bankName,
        accountName: paymentDetails.accountName,
        accountNumber: paymentDetails.accountNumber,
        paymentReference: order.orderId,
        paymentInstructions: paymentDetails.instructions,
      });

      dispatchNotification({
        laundryId,
        branchId: order.currentBranchId ?? null,
        eventType: type === "ready" ? "order_ready" : "overdue",
        orderId: order.id,
        customerId: order.customerId ?? null,
        customerPhone: order.phone,
        customerName: order.customerName,
        variables: vars,
      }).catch((err) =>
        console.error("[orders] dispatchNotification failed:", err)
      );

      res.json({
        queued: true,
        message: type === "ready"
          ? "Ready for pickup notification queued"
          : "Pickup reminder queued",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to send notification" });
    }
  }
);

// GET /orders/:id/messages — message history for this order (workers + owners)
ordersRouter.get(
  "/:id/messages",
  checkPermission("view:orders"),
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const orderId = parseInt(req.params.id);

      const [order] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.laundryId, laundryId)));

      if (!order) return res.status(404).json({ error: "Order not found" });

      const messages = await db
        .select({
          id: notificationMessages.id,
          channel: notificationMessages.channel,
          recipientPhone: notificationMessages.recipientPhone,
          recipientName: notificationMessages.recipientName,
          renderedBody: notificationMessages.renderedBody,
          status: notificationMessages.status,
          providerMessageId: notificationMessages.providerMessageId,
          retryCount: notificationMessages.retryCount,
          errorMessage: notificationMessages.errorMessage,
          queuedAt: notificationMessages.queuedAt,
          sentAt: notificationMessages.sentAt,
          deliveredAt: notificationMessages.deliveredAt,
          readAt: notificationMessages.readAt,
          failedAt: notificationMessages.failedAt,
          metadata: notificationMessages.metadata,
        })
        .from(notificationMessages)
        .innerJoin(
          notificationEvents,
          eq(notificationMessages.eventId, notificationEvents.id)
        )
        .where(
          and(
            eq(notificationMessages.laundryId, laundryId),
            eq(notificationEvents.orderId, orderId)
          )
        )
        .orderBy(desc(notificationMessages.queuedAt))
        .limit(50);

      res.json({ messages, total: messages.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch message history" });
    }
  }
);

// POST /orders/:id/messages/:msgId/retry — retry a failed message
ordersRouter.post(
  "/:id/messages/:msgId/retry",
  checkPermission("process:orders"),
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const orderId = parseInt(req.params.id);
      const msgId = parseInt(req.params.msgId);

      const [order] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.laundryId, laundryId)));

      if (!order) return res.status(404).json({ error: "Order not found" });

      const [msg] = await db
        .select()
        .from(notificationMessages)
        .where(
          and(
            eq(notificationMessages.id, msgId),
            eq(notificationMessages.laundryId, laundryId)
          )
        );

      if (!msg) return res.status(404).json({ error: "Message not found" });
      if (msg.status !== "failed") {
        return res.status(400).json({ error: "Only failed messages can be retried" });
      }

      // Re-queue the message
      await db
        .update(notificationMessages)
        .set({
          status: "queued",
          retryCount: msg.retryCount + 1,
          errorMessage: null,
          failedAt: null,
        })
        .where(eq(notificationMessages.id, msgId));

      // Fire the send via provider registry
      const { providerRegistry } = await import("../lib/providers/registry.js");
      const provider = await providerRegistry.getProvider(
        laundryId,
        msg.channel as any
      );

      if (provider) {
        try {
          const result = await provider.send({
            phone: msg.recipientPhone,
            body: msg.renderedBody,
          });
          await db
            .update(notificationMessages)
            .set({ status: "sent", providerMessageId: result.providerMessageId ?? null, sentAt: new Date() })
            .where(eq(notificationMessages.id, msgId));
          return res.json({ success: true, status: "sent" });
        } catch (sendErr: unknown) {
          const errorMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
          await db
            .update(notificationMessages)
            .set({ status: "failed", errorMessage: errorMsg, failedAt: new Date() })
            .where(eq(notificationMessages.id, msgId));
          return res.json({ success: false, error: errorMsg, status: "failed" });
        }
      }

      res.json({ success: true, status: "queued", note: "No provider configured — message queued" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to retry message" });
    }
  }
);
