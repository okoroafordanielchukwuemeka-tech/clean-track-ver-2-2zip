import { Router } from "express";
import { db } from "@workspace/db";
import { idempotencyMiddleware } from "../lib/idempotency.js";
import { orders, paymentRecords, orderItems, customers, laundries, services, priceAdjustments, discountApprovals, auditLog, branches, workers } from "@workspace/db/schema";
import { eq, desc, and, count, inArray, sql, isNull } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { requireOperational, requirePlanLimit } from "../middleware/subscription.js";
import { logAction, actorName } from "../lib/audit.js";
import { emitEvent } from "../lib/events.js";

export const ordersRouter = Router();

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
  const result = await tx.execute(
    sql`INSERT INTO receipt_number_counters (date_part, counter)
        SELECT
          ${datePart},
          COALESCE(
            MAX(CAST(SUBSTRING(receipt_number FROM ${sql.raw(String(prefix.length + 1))}) AS INTEGER)),
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
 * Formats a production-safe orderId from a database serial `id`.
 *
 * Format: YYYYMMDD + id padded to 6 digits  →  e.g. "20260603000042"
 *
 * Why the serial id?  The orders.id column is a PostgreSQL SERIAL (sequence),
 * globally unique and monotonically increasing.  Using it as the suffix makes
 * orderId collision-free under any load, across any number of laundries,
 * branches, Node processes, or concurrent workers — no coordination required.
 *
 * Date prefix: keeps IDs human-readable and chronologically sortable.
 * Padding to 6 digits supports up to 999 999 total orders per calendar day
 * across the whole system before recycling (effectively infinite at any
 * realistic production scale).
 *
 * Backward compatibility: existing records generated with the old 3-digit
 * random scheme remain valid — the uniqueness constraint is on the text value
 * regardless of format.
 */
function formatOrderId(serialId: number): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${datePart}${String(serialId).padStart(6, "0")}`;
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
  discount: z.number().optional(),
  discountReason: z.string().optional(),
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

const workerOrderUpdateSchema = z.object({
  status: z.enum(["pending", "processing", "ready", "partial_pickup", "completed", "cancelled"]).optional(),
  paymentStatus: z.enum(["unpaid", "partial", "paid"]).optional(),
  verifiedShirts: z.number().int().optional(),
  verifiedTrousers: z.number().int().optional(),
  isVerified: z.boolean().optional(),
  additionalNotes: z.string().optional(),
  assignedWorkerId: z.number().int().nullable().optional(),
});

const ownerOrderUpdateSchema = workerOrderUpdateSchema.extend({
  price: z.number().optional(),
  extraCharge: z.number().optional(),
  discount: z.number().optional(),
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
    if (effectiveBranchId) conditions.push(eq(orders.branchId, effectiveBranchId));

    const [orderList, [{ total }]] = await Promise.all([
      db.select().from(orders)
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt))
        .limit(parseInt(limit as string))
        .offset(parseInt(offset as string)),
      db.select({ total: count() }).from(orders).where(and(...conditions)),
    ]);

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
    if (effectiveBranchId) summaryConditions.push(eq(orders.branchId, effectiveBranchId));
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
    if (effectiveBranchId) conditions.push(eq(orders.branchId, effectiveBranchId));
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
    if (workerBranchId) idConditions.push(eq(orders.branchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...idConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

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

    let customerId: number | null = data.customerId ?? null;
    const phoneNorm = data.phone.trim();

    if (!customerId) {
      const [existingCustomer] = await db.select().from(customers)
        .where(and(eq(customers.laundryId, laundryId), eq(customers.phone, phoneNorm)));

      if (existingCustomer) {
        customerId = existingCustomer.id;
        await db.update(customers).set({ lastActivityAt: new Date() }).where(eq(customers.id, existingCustomer.id));
      } else {
        const [newCustomer] = await db.insert(customers).values({
          laundryId,
          fullName: data.customerName,
          phone: phoneNorm,
          address: data.address,
        }).returning();
        customerId = newCustomer.id;
      }
    } else {
      const [ownedCustomer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId!), eq(customers.laundryId, laundryId)));
      if (!ownedCustomer) {
        return res.status(403).json({ error: "Customer not found" });
      }
      await db.update(customers).set({ lastActivityAt: new Date() }).where(eq(customers.id, customerId!));
    }

    const sla = await getLaundrySla(laundryId);
    const createdAt = new Date();
    const processingDueAt = computeProcessingDueAt(createdAt, data.serviceType, sla);

    let computedPrice = data.price;
    let insertedItems: typeof orderItems.$inferSelect[] = [];
    let resolvedItems: Array<{ serviceId: number; name: string; quantity: number; unitPrice: number; lineTotal: number }> = [];

    if (data.items && data.items.length > 0) {
      const activeServices = await db.select().from(services)
        .where(and(eq(services.laundryId, laundryId), eq(services.isActive, true)));

      const serviceMap = new Map(activeServices.map(s => [s.id, s]));

      for (const item of data.items) {
        const svc = serviceMap.get(item.serviceId);
        if (!svc) {
          return res.status(400).json({ error: `Service ID ${item.serviceId} not found or is inactive` });
        }
        const priceField = data.serviceType === "express" ? svc.expressPrice
          : data.serviceType === "premium" ? svc.premiumPrice
          : svc.standardPrice;
        const unitPrice = parseFloat(priceField ?? svc.standardPrice);
        resolvedItems.push({ serviceId: svc.id, name: svc.name, quantity: item.quantity, unitPrice, lineTotal: item.quantity * unitPrice });
      }

      computedPrice = resolvedItems.reduce((sum, i) => sum + i.lineTotal, 0);
    }

    const orderBranchId = req.auth!.branchId ?? ((req.body as any).branchId ? parseInt((req.body as any).branchId) : undefined);

    // Two-step insert+update inside a transaction guarantees orderId is
    // collision-free: the placeholder UUID satisfies the NOT NULL / UNIQUE
    // constraint on insert, and is immediately replaced with the formatted
    // serial-based ID before any other code sees it.
    const order = await db.transaction(async (tx) => {
      const placeholder = `GEN-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [inserted] = await tx.insert(orders).values({
        laundryId,
        branchId: orderBranchId,
        customerId,
        orderId: placeholder,
        customerName: data.customerName,
        phone: phoneNorm,
        address: data.address,
        serviceType: data.serviceType,
        shirts: data.shirts ?? 0,
        trousers: data.trousers ?? 0,
        additionalNotes: data.additionalNotes,
        price: computedPrice?.toString(),
        extraCharge: data.extraCharge?.toString(),
        discount: data.discount?.toString(),
        processingDueAt,
      }).returning();

      const finalOrderId = formatOrderId(inserted.id);
      await tx.update(orders)
        .set({ orderId: finalOrderId })
        .where(eq(orders.id, inserted.id));

      return { ...inserted, orderId: finalOrderId };
    });

    if (resolvedItems.length > 0) {
      const itemRows = resolvedItems.map(item => ({
        orderId: order.id,
        serviceId: item.serviceId,
        serviceType: data.serviceType,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        totalPrice: item.lineTotal.toString(),
      }));
      insertedItems = await db.insert(orderItems).values(itemRows).returning();
    }

    const adjustmentRows: typeof priceAdjustments.$inferInsert[] = [];
    const appliedBy = actorName(req.auth!);

    if (data.discount && data.discount > 0 && data.discountReason) {
      adjustmentRows.push({
        orderId: order.id,
        laundryId,
        type: "discount",
        amount: data.discount.toString(),
        reason: data.discountReason,
        appliedBy,
      });
    }
    if (data.extraCharge && data.extraCharge > 0 && data.extraChargeReason) {
      adjustmentRows.push({
        orderId: order.id,
        laundryId,
        type: "extra_charge",
        amount: data.extraCharge.toString(),
        reason: data.extraChargeReason,
        appliedBy,
      });
    }
    if (adjustmentRows.length > 0) {
      await db.insert(priceAdjustments).values(adjustmentRows);
    }

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

ordersRouter.patch("/:id", checkPermission("process:orders"), idempotencyMiddleware, async (req: AuthRequest, res) => {
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
      // Workers need canAssignOrders to change the assigned worker
      if ("assignedWorkerId" in req.body && !req.auth!.permissions?.canAssignOrders) {
        return res.status(403).json({
          error: "Permission denied",
          required: "assign:orders",
          hint: "You don't have permission to assign orders. Contact your manager.",
        });
      }
    }

    const data = isOwner
      ? ownerOrderUpdateSchema.parse(req.body)
      : workerOrderUpdateSchema.parse(req.body);

    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (isOwner) {
      if ((data as any).price !== undefined) updateData.price = (data as any).price?.toString();
      if ((data as any).extraCharge !== undefined) updateData.extraCharge = (data as any).extraCharge?.toString();
      if ((data as any).discount !== undefined) updateData.discount = (data as any).discount?.toString();
    }

    const patchConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) patchConditions.push(eq(orders.branchId, workerBranchId));

    const [beforeOrder] = await db.select().from(orders).where(and(...patchConditions));

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

    const [order] = await db.update(orders).set(updateData)
      .where(and(...patchConditions))
      .returning();
    if (!order) return res.status(404).json({ error: "Order not found" });

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
    if (workerBranchId) conditions.push(eq(orders.branchId, workerBranchId));

    const [existing] = await db.select().from(orders).where(and(...conditions));
    if (!existing) return res.status(404).json({ error: "Order not found" });

    if (existing.status === "completed") {
      return res.status(409).json({ error: "Cannot delete a completed order. Completed orders are permanently preserved for financial records." });
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
    if (workerBranchId) pmtConditions.push(eq(orders.branchId, workerBranchId));
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
    });
    const data = paymentSchema.parse(req.body);
    const orderId = parseInt(req.params.id);

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
        ? sql` AND branch_id = ${workerBranchId}`
        : sql``;
      const lockResult = await tx.execute(
        sql`SELECT id, order_id, customer_name, branch_id, price, extra_charge,
                   discount, amount_paid, payment_status
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
      }).returning();

      await tx.update(orders).set({
        amountPaid: newAmountPaid.toString(),
        paymentStatus,
        updatedAt: new Date(),
      }).where(eq(orders.id, row.id));

      return {
        payment,
        orderId: row.id,
        orderRef: row.order_id as string,
        customerName: row.customer_name as string,
        remainingBalance,
        paymentStatus,
      };
    });

    if (!txResult) return res.status(404).json({ error: "Order not found" });

    const { payment, orderId: oId, orderRef, customerName, remainingBalance, paymentStatus } = txResult;

    emitEvent({
      laundryId,
      eventType: "payment_received",
      title: "Payment Received",
      message: `₦${data.amount.toLocaleString()} received for Order #${orderRef} (${customerName}) via ${data.method}. Balance: ₦${remainingBalance.toLocaleString()}.`,
      severity: remainingBalance <= 0 ? "success" : "info",
      relatedOrderId: oId,
    }).catch(() => {});

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
      },
    }).catch(() => {});

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
    const delPmtConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) delPmtConditions.push(eq(orders.branchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...delPmtConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const paymentId = parseInt(req.params.paymentId);
    const [existing] = await db.select().from(paymentRecords)
      .where(and(eq(paymentRecords.id, paymentId), eq(paymentRecords.orderId, order.id)));
    if (!existing || existing.deletedAt) return res.status(404).json({ error: "Payment not found" });

    const auth = req.auth!;
    await db.update(paymentRecords).set({
      deletedAt: new Date(),
      deletedById: auth.type === "owner" ? (auth.ownerId ?? null) : (auth.workerId ?? null),
      deletedByType: auth.type,
      deletedByName: auth.name ?? auth.email ?? "unknown",
    }).where(eq(paymentRecords.id, paymentId));

    // Recalculate order balance excluding soft-deleted payments
    const remaining = await db.select().from(paymentRecords)
      .where(and(eq(paymentRecords.orderId, order.id), isNull(paymentRecords.deletedAt)));
    const newAmountPaid = remaining.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const totalDue = parseFloat(order.price || "0") + parseFloat(order.extraCharge || "0") - parseFloat(order.discount || "0");
    const newPaymentStatus = totalDue <= 0 || newAmountPaid >= totalDue ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid";

    await db.update(orders).set({
      amountPaid: newAmountPaid.toString(),
      paymentStatus: newPaymentStatus,
      updatedAt: new Date(),
    }).where(eq(orders.id, order.id));

    logAction({
      auth,
      laundryId,
      action: "payment_voided",
      orderId: order.id,
      metadata: { paymentId: existing.id, receiptNumber: existing.receiptNumber, amount: existing.amount, newAmountPaid, newPaymentStatus, orderId: order.orderId },
    }).catch(() => {});

    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to void payment" });
  }
});

ordersRouter.get("/:id/items", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const itemsGetConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) itemsGetConditions.push(eq(orders.branchId, workerBranchId));
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
    if (workerBranchId) itemsPostConditions.push(eq(orders.branchId, workerBranchId));
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
    if (workerBranchId) receiptConditions.push(eq(orders.branchId, workerBranchId));
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
      order.branchId
        ? db.select().from(branches).where(eq(branches.id, order.branchId)).then(r => r[0] ?? null)
        : Promise.resolve(null),
      latestPayment?.workerId
        ? db.select({ name: workers.name }).from(workers).where(eq(workers.id, latestPayment.workerId)).then(r => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    const businessProfile = (laundry?.businessProfile ?? {}) as Record<string, string>;
    const brandingSettings = (laundry?.brandingSettings ?? {}) as Record<string, string>;

    const basePrice = parseFloat(order.price || "0");
    const extraCharge = parseFloat(order.extraCharge || "0");
    const discount = parseFloat(order.discount || "0");
    const totalDue = basePrice + extraCharge - discount;
    const amountPaid = parseFloat(order.amountPaid || "0");
    const balance = Math.max(0, totalDue - amountPaid);

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
        logoUrl: businessProfile.logoUrl ?? "",
        receiptHeaderName: brandingSettings.receiptHeaderName ?? laundry?.businessName ?? "",
        receiptFooterText: brandingSettings.receiptFooterText ?? "",
        brandColor: brandingSettings.brandColor ?? "",
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
        branchId: order.branchId,
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
    if (workerBranchId) auditConditions.push(eq(orders.branchId, workerBranchId));
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
    if (workerBranchId) paGetConditions.push(eq(orders.branchId, workerBranchId));
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
    if (workerBranchId) paPostConditions.push(eq(orders.branchId, workerBranchId));
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
