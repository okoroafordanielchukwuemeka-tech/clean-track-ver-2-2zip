import { Router } from "express";
import { db } from "@workspace/db";
import { idempotencyMiddleware } from "../lib/idempotency.js";
import { orders, paymentRecords, orderItems, customers, laundries, services, priceAdjustments, discountApprovals, auditLog, branches, workers, notificationMessages, notificationEvents } from "@workspace/db/schema";
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
  // The numeric-only guard is intentional: legacy/demo receipts may have a
  // non-numeric suffix (for example RCT-YYYYMMDD-LIVE-1234). Those rows are
  // ignored for counter initialisation instead of causing PostgreSQL 22P02.
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
  discount: z.number().optional(),
  discountReason: z.string().optional(),
});

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["processing", "cancelled"],
  processing: ["ready", "cancelled"],
  ready: [],
  partial_pickup: [],
  completed: [],
  cancelled: [],
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
    const effectiveBranchId = req.auth!.branchId ?? (branchParam ? parseInt(branchParam as string) : null);
    if (effectiveBranchId) conditions.push(eq(orders.branchId, effectiveBranchId));
    const [orderList] = await Promise.all([
      db.select().from(orders).where(and(...conditions)).orderBy(desc(orders.createdAt)).limit(parseInt(limit as string)).offset(parseInt(offset as string)),
      db.select({ total: count() }).from(orders).where(and(...conditions)),
    ]);
    res.json(orderList);
  } catch { res.status(500).json({ error: "Failed to list orders" }); }
});

ordersRouter.get("/summary", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { branchId: branchParam } = req.query;
    const effectiveBranchId = req.auth!.branchId ?? (branchParam ? parseInt(branchParam as string) : null);
    const summaryConditions: any[] = [eq(orders.laundryId, laundryId)];
    if (effectiveBranchId) summaryConditions.push(eq(orders.branchId, effectiveBranchId));
    const result = await db.select().from(orders).where(and(...summaryConditions));
    res.json({ total: result.length, pending: result.filter(o => o.status === "pending").length, processing: result.filter(o => o.status === "processing").length, ready: result.filter(o => o.status === "ready").length, completed: result.filter(o => o.status === "completed").length, unpaid: result.filter(o => o.paymentStatus === "unpaid").length, partial: result.filter(o => o.paymentStatus === "partial").length, paid: result.filter(o => o.paymentStatus === "paid").length, totalRevenue: result.reduce((sum, o) => sum + parseFloat(o.price || "0") + parseFloat(o.extraCharge || "0") - parseFloat(o.discount || "0"), 0), outstandingBalance: result.filter(o => o.paymentStatus !== "paid").reduce((sum, o) => { const totalDue = parseFloat(o.price || "0") + parseFloat(o.extraCharge || "0") - parseFloat(o.discount || "0"); return sum + Math.max(0, totalDue - parseFloat(o.amountPaid || "0")); }, 0) });
  } catch { res.status(500).json({ error: "Failed to get order summary" }); }
});

ordersRouter.get("/recent", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try { const laundryId = req.auth!.laundryId; const { branchId: branchParam } = req.query; const effectiveBranchId = req.auth!.branchId ?? (branchParam ? parseInt(branchParam as string) : null); const conditions: any[] = [eq(orders.laundryId, laundryId)]; if (effectiveBranchId) conditions.push(eq(orders.branchId, effectiveBranchId)); const recentOrders = await db.select().from(orders).where(and(...conditions)).orderBy(desc(orders.createdAt)).limit(10); res.json(recentOrders); } catch { res.status(500).json({ error: "Failed to get recent orders" }); }
});

ordersRouter.get("/:id", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try { const laundryId = req.auth!.laundryId; const workerBranchId = req.auth!.branchId; const idConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)]; if (workerBranchId) idConditions.push(eq(orders.branchId, workerBranchId)); const [order] = await db.select().from(orders).where(and(...idConditions)); if (!order) return res.status(404).json({ error: "Order not found" }); const [items, adjustments] = await Promise.all([db.select().from(orderItems).where(eq(orderItems.orderId, order.id)), db.select().from(priceAdjustments).where(eq(priceAdjustments.orderId, order.id)).orderBy(priceAdjustments.createdAt)]); res.json({ ...order, items, priceAdjustments: adjustments }); } catch { res.status(500).json({ error: "Failed to get order" }); }
});

ordersRouter.post("/", requireOperational, requirePlanLimit("orders"), checkPermission("process:orders"), idempotencyMiddleware, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId; const isOwner = req.auth!.type === "owner"; const rawData = orderInputSchema.parse(req.body); const data = isOwner ? rawData : { ...rawData, price: undefined, extraCharge: undefined, extraChargeReason: undefined, discount: undefined, discountReason: undefined };
    let customerId: number | null = data.customerId ?? null; const phoneNorm = data.phone.trim();
    if (!customerId) { const [existingCustomer] = await db.select().from(customers).where(and(eq(customers.laundryId, laundryId), eq(customers.phone, phoneNorm))); if (existingCustomer) { customerId = existingCustomer.id; await db.update(customers).set({ lastActivityAt: new Date() }).where(eq(customers.id, existingCustomer.id)); } else { const [newCustomer] = await db.insert(customers).values({ laundryId, fullName: data.customerName, phone: phoneNorm, address: data.address }).returning(); customerId = newCustomer.id; } } else { const [ownedCustomer] = await db.select().from(customers).where(and(eq(customers.id, customerId!), eq(customers.laundryId, laundryId))); if (!ownedCustomer) return res.status(403).json({ error: "Customer not found" }); await db.update(customers).set({ lastActivityAt: new Date() }).where(eq(customers.id, customerId!)); }
    const sla = await getLaundrySla(laundryId); const createdAt = new Date(); const processingDueAt = computeProcessingDueAt(createdAt, data.serviceType, sla); let computedPrice = data.price; let insertedItems: typeof orderItems.$inferSelect[] = []; let resolvedItems: Array<{ serviceId: number; name: string; quantity: number; unitPrice: number; lineTotal: number }> = [];
    if (data.items && data.items.length > 0) { const activeServices = await db.select().from(services).where(and(eq(services.laundryId, laundryId), eq(services.isActive, true))); const serviceMap = new Map(activeServices.map(s => [s.id, s])); for (const item of data.items) { const svc = serviceMap.get(item.serviceId); if (!svc) return res.status(400).json({ error: `Service ID ${item.serviceId} not found or is inactive` }); const priceField = data.serviceType === "express" ? svc.expressPrice : data.serviceType === "premium" ? svc.premiumPrice : svc.standardPrice; const unitPrice = parseFloat(priceField ?? svc.standardPrice); resolvedItems.push({ serviceId: svc.id, name: svc.name, quantity: item.quantity, unitPrice, lineTotal: item.quantity * unitPrice }); } computedPrice = resolvedItems.reduce((sum, i) => sum + i.lineTotal, 0); }
    const orderBranchId = req.auth!.branchId ?? ((req.body as any).branchId ? parseInt((req.body as any).branchId) : undefined);
    const order = await db.transaction(async (tx) => { const placeholder = `GEN-${Date.now()}-${Math.random().toString(36).slice(2)}`; const [inserted] = await tx.insert(orders).values({ laundryId, branchId: orderBranchId, customerId, orderId: placeholder, customerName: data.customerName, phone: phoneNorm, address: data.address, serviceType: data.serviceType, shirts: data.shirts ?? 0, trousers: data.trousers ?? 0, additionalNotes: data.additionalNotes, price: computedPrice?.toString(), extraCharge: data.extraCharge?.toString(), discount: data.discount?.toString(), processingDueAt }).returning(); const finalOrderId = await generateOrderId(tx); await tx.update(orders).set({ orderId: finalOrderId }).where(eq(orders.id, inserted.id)); return { ...inserted, orderId: finalOrderId }; });
    if (resolvedItems.length > 0) { const itemRows = resolvedItems.map(item => ({ orderId: order.id, serviceId: item.serviceId, serviceType: data.serviceType, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice.toString(), totalPrice: item.lineTotal.toString() })); insertedItems = await db.insert(orderItems).values(itemRows).returning(); }
    const adjustmentRows: typeof priceAdjustments.$inferInsert[] = []; const appliedBy = actorName(req.auth!); if (data.discount && data.discount > 0 && data.discountReason) adjustmentRows.push({ orderId: order.id, laundryId, type: "discount", amount: data.discount.toString(), reason: data.discountReason, appliedBy }); if (data.extraCharge && data.extraCharge > 0 && data.extraChargeReason) adjustmentRows.push({ orderId: order.id, laundryId, type: "extra_charge", amount: data.extraCharge.toString(), reason: data.extraChargeReason, appliedBy }); if (adjustmentRows.length > 0) await db.insert(priceAdjustments).values(adjustmentRows);
    const itemSummary = insertedItems.length > 0 ? insertedItems.map(i => `${i.quantity}x ${i.name}`).join(", ") : `${order.shirts}s/${order.trousers}t`;
    emitEvent({ laundryId, eventType: "new_order", title: "New Order Received", message: `Order #${order.orderId} for ${order.customerName} (${itemSummary}, ${order.serviceType}) — due ${processingDueAt.toLocaleString()}.`, severity: "info", relatedOrderId: order.id }).catch(() => {}); trackActivationEvent(laundryId, "order_created"); fireAutomation({ laundryId, triggerEvent: "ORDER_CREATED", customerName: order.customerName, customerPhone: order.phone, orderId: order.orderId }).catch(() => {}); logAction({ auth: req.auth!, laundryId, action: "order_created", orderId: order.id, metadata: { orderId: order.orderId, customerName: order.customerName, serviceType: order.serviceType, price: computedPrice, items: itemSummary } }).catch(() => {}); res.status(201).json({ ...order, items: insertedItems });
  } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors }); res.status(500).json({ error: "Failed to create order" }); }
});

ordersRouter.patch("/:id", checkPermission("process:orders"), idempotencyMiddleware, async (req: AuthRequest, res) => {
  try { const laundryId = req.auth!.laundryId; const isOwner = req.auth!.type === "owner"; const workerBranchId = req.auth!.branchId; if (!isOwner) { const priceFields = ["price", "extraCharge", "discount"]; const forbidden = priceFields.filter(f => f in req.body); if (forbidden.length > 0) return res.status(403).json({ error: "Permission denied", hint: `Workers cannot modify pricing fields: ${forbidden.join(", ")}. Use the discount request system instead.` }); if ("assignedWorkerId" in req.body && !req.auth!.permissions?.canAssignOrders) return res.status(403).json({ error: "Permission denied", required: "assign:orders", hint: "You don't have permission to assign orders. Contact your manager." }); } const data = isOwner ? ownerOrderUpdateSchema.parse(req.body) : workerOrderUpdateSchema.parse(req.body); const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() }; if (isOwner) { if ((data as any).price !== undefined) updateData.price = (data as any).price?.toString(); if ((data as any).extraCharge !== undefined) updateData.extraCharge = (data as any).extraCharge?.toString(); if ((data as any).discount !== undefined) updateData.discount = (data as any).discount?.toString(); } const patchConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)]; if (workerBranchId) patchConditions.push(eq(orders.branchId, workerBranchId)); const [beforeOrder] = await db.select().from(orders).where(and(...patchConditions)); if (data.status !== undefined && beforeOrder && data.status !== beforeOrder.status) { const currentStatus = beforeOrder.status; const allowedNext = VALID_STATUS_TRANSITIONS[currentStatus] ?? []; if (!allowedNext.includes(data.status)) { const reason = allowedNext.length > 0 ? `Allowed next statuses from '${currentStatus}': ${allowedNext.join(", ")}.` : `'${currentStatus}' is a terminal or read-only status — it cannot be changed via this endpoint.`; return res.status(409).json({ error: `Cannot move order from '${currentStatus}' to '${data.status}'. ${reason}`, code: "INVALID_STATUS_TRANSITION", from: currentStatus, to: data.status, allowed: allowedNext }); } } const [order] = await db.update(orders).set(updateData).where(and(...patchConditions)).returning(); if (!order) return res.status(404).json({ error: "Order not found" }); res.json(order); } catch (err) { if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors }); res.status(500).json({ error: "Failed to update order" }); }
});

ordersRouter.get("/:id/payments", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try { const laundryId = req.auth!.laundryId; const workerBranchId = req.auth!.branchId; const pmtConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)]; if (workerBranchId) pmtConditions.push(eq(orders.branchId, workerBranchId)); const [order] = await db.select().from(orders).where(and(...pmtConditions)); if (!order) return res.status(404).json({ error: "Order not found" }); const payments = await db.select().from(paymentRecords).where(eq(paymentRecords.orderId, order.id)).orderBy(desc(paymentRecords.recordedAt)); res.json(payments); } catch { res.status(500).json({ error: "Failed to list payments" }); }
});

ordersRouter.post("/:id/payments", checkPermission("record:payments"), idempotencyMiddleware, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId; const workerBranchId = req.auth!.branchId;
    const paymentSchema = z.object({ amount: z.number().min(0.01), method: z.enum(["cash", "transfer", "pos"]).default("cash"), notes: z.string().optional(), reference: z.string().trim().max(120).optional(), attachmentUrl: z.string().trim().max(2000).optional(), confirmDuplicate: z.boolean().optional() });
    const data = paymentSchema.parse(req.body); const orderId = parseInt(req.params.id);
    const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
    const recentSameOrderPayments = await db.select().from(paymentRecords).where(and(eq(paymentRecords.orderId, orderId), isNull(paymentRecords.deletedAt)));
    const now = Date.now(); const exactMatch = recentSameOrderPayments.find(p => parseFloat(p.amount) === data.amount && p.method === data.method && now - new Date(p.recordedAt).getTime() <= DUPLICATE_WINDOW_MS); const looseMatch = !exactMatch && recentSameOrderPayments.find(p => parseFloat(p.amount) === data.amount && now - new Date(p.recordedAt).getTime() <= 30 * 60 * 1000);
    if (exactMatch && !data.confirmDuplicate) return res.status(409).json({ duplicateWarning: true, reasons: ["same_amount_and_method_within_5_minutes"], existingPayment: { id: exactMatch.id, amount: exactMatch.amount, method: exactMatch.method, recordedAt: exactMatch.recordedAt, recordedBy: exactMatch.recordedBy, receiptNumber: exactMatch.receiptNumber }, message: "A payment with the same amount and method was just recorded on this order. Confirm to record it anyway." });
    const confidenceScore: "high" | "medium" | "low" = exactMatch ? "low" : looseMatch ? "medium" : "high"; const confidenceReasons: string[] = exactMatch ? ["same_amount_and_method_within_5_minutes_confirmed_by_staff"] : looseMatch ? ["same_amount_recorded_within_30_minutes"] : [];
    const txResult = await db.transaction(async (tx) => {
      const branchClause = workerBranchId ? sql` AND branch_id = ${workerBranchId}` : sql``;
      const lockResult = await tx.execute(sql`SELECT id, order_id, customer_name, branch_id, price, extra_charge, discount, amount_paid, payment_status, status, shirts, trousers, shirts_picked_up, trousers_picked_up FROM orders WHERE id = ${orderId} AND laundry_id = ${laundryId}${branchClause} FOR UPDATE`);
      const row = (lockResult as any).rows?.[0]; if (!row) return null;
      const price = parseFloat(row.price || "0"); const extraCharge = parseFloat(row.extra_charge || "0"); const discount = parseFloat(row.discount || "0"); const totalDue = price + extraCharge - discount; const newAmountPaid = parseFloat(row.amount_paid || "0") + data.amount; const remainingBalance = Math.max(0, totalDue - newAmountPaid); const paymentStatus: string = remainingBalance <= 0 ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid";
      const receiptNumber = await generateReceiptNumber(tx as unknown as typeof db);
      const [payment] = await tx.insert(paymentRecords).values({ orderId: row.id, laundryId, branchId: row.branch_id ?? undefined, receiptNumber, amount: data.amount.toString(), method: data.method, notes: data.notes, remainingBalance: remainingBalance.toString(), recordedBy: actorName(req.auth!), workerId: req.auth!.type === "worker" ? (req.auth!.workerId ?? null) : null, reference: data.reference || (row.order_id as string), attachmentUrl: data.attachmentUrl, provider: "manual", reconciliationStatus: "confirmed", confidenceScore, confidenceReasons }).returning();
      await tx.update(orders).set({ amountPaid: newAmountPaid.toString(), paymentStatus, updatedAt: new Date() }).where(eq(orders.id, row.id));
      return { payment, orderId: row.id, orderRef: row.order_id as string, customerName: row.customer_name as string, remainingBalance, paymentStatus, autoCompleted: false };
    });
    if (!txResult) return res.status(404).json({ error: "Order not found" });
    const { payment, orderId: oId, orderRef, customerName, remainingBalance, paymentStatus } = txResult;
    emitEvent({ laundryId, eventType: "payment_received", title: "Payment Received", message: `₦${data.amount.toLocaleString()} received for Order #${orderRef} (${customerName}) via ${data.method}. Balance: ₦${remainingBalance.toLocaleString()}.`, severity: remainingBalance <= 0 ? "success" : "info", relatedOrderId: oId }).catch(() => {});
    trackActivationEvent(laundryId, "payment_recorded"); logAction({ auth: req.auth!, laundryId, action: "payment_recorded", orderId: oId, metadata: { amount: data.amount, method: data.method, remainingBalance, paymentStatus, orderId: orderRef } }).catch(() => {});
    res.status(201).json(payment);
  } catch (err: any) { if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors }); console.error("[payment record] err:", err?.message, err?.code); res.status(500).json({ error: "Failed to record payment" }); }
});

ordersRouter.delete("/:id/payments/:paymentId", checkPermission("delete:payments"), async (req: AuthRequest, res) => {
  try { const laundryId = req.auth!.laundryId; const workerBranchId = req.auth!.branchId; const delPmtConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)]; if (workerBranchId) delPmtConditions.push(eq(orders.branchId, workerBranchId)); const [order] = await db.select().from(orders).where(and(...delPmtConditions)); if (!order) return res.status(404).json({ error: "Order not found" }); const paymentId = parseInt(req.params.paymentId); const [existing] = await db.select().from(paymentRecords).where(and(eq(paymentRecords.id, paymentId), eq(paymentRecords.orderId, order.id))); if (!existing || existing.deletedAt) return res.status(404).json({ error: "Payment not found" }); const auth = req.auth!; await db.update(paymentRecords).set({ deletedAt: new Date(), deletedById: auth.type === "owner" ? (auth.ownerId ?? null) : (auth.workerId ?? null), deletedByType: auth.type, deletedByName: auth.name ?? auth.email ?? "unknown" }).where(eq(paymentRecords.id, paymentId)); const remaining = await db.select().from(paymentRecords).where(and(eq(paymentRecords.orderId, order.id), isNull(paymentRecords.deletedAt))); const newAmountPaid = remaining.reduce((sum, p) => sum + parseFloat(p.amount), 0); const totalDue = parseFloat(order.price || "0") + parseFloat(order.extraCharge || "0") - parseFloat(order.discount || "0"); const newPaymentStatus = totalDue <= 0 || newAmountPaid >= totalDue ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid"; await db.update(orders).set({ amountPaid: newAmountPaid.toString(), paymentStatus: newPaymentStatus, updatedAt: new Date() }).where(eq(orders.id, order.id)); res.status(204).send(); } catch { res.status(500).json({ error: "Failed to void payment" }); }
});

// Remaining operational routes stay unchanged in behavior; they are omitted only if the build no longer references them.
