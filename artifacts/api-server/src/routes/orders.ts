import { Router } from "express";
import { db } from "@workspace/db";
import { orders, paymentRecords, orderItems, customers, laundries, services, priceAdjustments, discountApprovals, auditLog } from "@workspace/db/schema";
import { eq, desc, and, count, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { logAction, actorName } from "../lib/audit.js";
import { emitEvent } from "../lib/events.js";

export const ordersRouter = Router();

const DEFAULT_TURNAROUND: Record<string, number> = { express: 24, premium: 48, standard: 72 };

async function generateReceiptNumber(offset = 0): Promise<string> {
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `RCT-${datePart}-`;
  const fromPos = prefix.length + 1; // 1-indexed SQL position of the numeric suffix
  // Query globally across all laundries/branches so receipt numbers are unique system-wide
  const [row] = await db
    .select({
      maxSuffix: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${paymentRecords.receiptNumber} FROM ${sql.raw(String(fromPos))}) AS INTEGER)), 0)`,
    })
    .from(paymentRecords)
    .where(sql`${paymentRecords.receiptNumber} LIKE ${prefix + "%"}`);
  const next = (Number(row?.maxSuffix ?? 0) + 1 + offset).toString().padStart(4, "0");
  return `${prefix}${next}`;
}

function generateOrderId() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${datePart}${rand}`;
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

const workerOrderUpdateSchema = z.object({
  status: z.enum(["pending", "processing", "ready", "partial_pickup", "completed"]).optional(),
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

ordersRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { status, paymentStatus, limit = "50", offset = "0", branchId: branchParam } = req.query;
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

ordersRouter.get("/summary", async (req: AuthRequest, res) => {
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

ordersRouter.get("/:id", async (req: AuthRequest, res) => {
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

ordersRouter.post("/", async (req: AuthRequest, res) => {
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

    const orderId = generateOrderId();

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

    const [order] = await db.insert(orders).values({
      laundryId,
      branchId: orderBranchId,
      customerId,
      orderId,
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

ordersRouter.patch("/:id", async (req: AuthRequest, res) => {
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
    const delConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) delConditions.push(eq(orders.branchId, workerBranchId));
    const [deleted] = await db.delete(orders).where(and(...delConditions)).returning();
    if (!deleted) return res.status(404).json({ error: "Order not found" });

    logAction({
      auth: req.auth!,
      laundryId,
      action: "order_deleted",
      metadata: { orderId: deleted.orderId, customerName: deleted.customerName },
    }).catch(() => {});

    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete order" });
  }
});

ordersRouter.get("/:id/payments", async (req: AuthRequest, res) => {
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

ordersRouter.post("/:id/payments", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const paymentSchema = z.object({
      amount: z.number().min(0.01),
      method: z.enum(["cash", "transfer", "pos"]).default("cash"),
      notes: z.string().optional(),
    });
    const data = paymentSchema.parse(req.body);
    const postPmtConditions: any[] = [eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)];
    if (workerBranchId) postPmtConditions.push(eq(orders.branchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...postPmtConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const price = parseFloat(order.price || "0");
    const extraCharge = parseFloat(order.extraCharge || "0");
    const discount = parseFloat(order.discount || "0");
    const totalDue = price + extraCharge - discount;
    const amountPaid = parseFloat(order.amountPaid || "0") + data.amount;
    const remainingBalance = Math.max(0, totalDue - amountPaid);
    const paymentStatus = remainingBalance <= 0 ? "paid" : amountPaid > 0 ? "partial" : "unpaid";

    // Retry on unique-constraint collision (concurrent inserts same day)
    let payment: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      const receiptNumber = await generateReceiptNumber(attempt);
      try {
        const [inserted] = await db.insert(paymentRecords).values({
          orderId: order.id,
          laundryId,
          branchId: order.branchId ?? undefined,
          receiptNumber,
          amount: data.amount.toString(),
          method: data.method,
          notes: data.notes,
          remainingBalance: remainingBalance.toString(),
          recordedBy: actorName(req.auth!),
          workerId: req.auth!.type === "worker" ? (req.auth!.workerId ?? null) : null,
        }).returning();
        payment = inserted;
        break;
      } catch (insertErr: any) {
        if (attempt < 4 && insertErr?.code === "23505" && insertErr?.constraint?.includes("receipt_number")) {
          continue; // unique violation on receipt number — retry
        }
        throw insertErr;
      }
    }
    if (!payment) throw new Error("Failed to generate unique receipt number after retries");

    await db.update(orders).set({
      amountPaid: amountPaid.toString(),
      paymentStatus,
      updatedAt: new Date(),
    }).where(eq(orders.id, order.id));

    emitEvent({
      laundryId,
      eventType: "payment_received",
      title: "Payment Received",
      message: `₦${data.amount.toLocaleString()} received for Order #${order.orderId} (${order.customerName}) via ${data.method}. Balance: ₦${remainingBalance.toLocaleString()}.`,
      severity: remainingBalance <= 0 ? "success" : "info",
      relatedOrderId: order.id,
    }).catch(() => {});

    logAction({
      auth: req.auth!,
      laundryId,
      action: "payment_recorded",
      orderId: order.id,
      metadata: {
        amount: data.amount,
        method: data.method,
        remainingBalance,
        paymentStatus,
        orderId: order.orderId,
      },
    }).catch(() => {});

    res.status(201).json(payment);
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error("[payment record] err:", err?.message, err?.code, err?.constraint);
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
    const [deleted] = await db.delete(paymentRecords)
      .where(and(eq(paymentRecords.id, parseInt(req.params.paymentId)), eq(paymentRecords.orderId, order.id)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Payment not found" });

    // Recalculate order balance after deleting this payment
    const remaining = await db.select().from(paymentRecords).where(eq(paymentRecords.orderId, order.id));
    const newAmountPaid = remaining.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const totalDue = parseFloat(order.price || "0") + parseFloat(order.extraCharge || "0") - parseFloat(order.discount || "0");
    const newPaymentStatus = totalDue <= 0 || newAmountPaid >= totalDue ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid";

    await db.update(orders).set({
      amountPaid: newAmountPaid.toString(),
      paymentStatus: newPaymentStatus,
      updatedAt: new Date(),
    }).where(eq(orders.id, order.id));

    logAction({
      auth: req.auth!,
      laundryId,
      action: "payment_deleted",
      orderId: order.id,
      metadata: { paymentId: deleted.id, amount: deleted.amount, newAmountPaid, newPaymentStatus, orderId: order.orderId },
    }).catch(() => {});

    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete payment" });
  }
});

ordersRouter.get("/:id/items", async (req: AuthRequest, res) => {
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

ordersRouter.get("/:id/receipt", async (req: AuthRequest, res) => {
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

    const businessProfile = (laundry?.businessProfile ?? {}) as Record<string, string>;
    const brandingSettings = (laundry?.brandingSettings ?? {}) as Record<string, string>;

    const basePrice = parseFloat(order.price || "0");
    const extraCharge = parseFloat(order.extraCharge || "0");
    const discount = parseFloat(order.discount || "0");
    const totalDue = basePrice + extraCharge - discount;
    const amountPaid = parseFloat(order.amountPaid || "0");
    const balance = Math.max(0, totalDue - amountPaid);

    const latestPayment = allPayments.length > 0 ? allPayments[allPayments.length - 1] : null;

    res.json({
      receipt: latestPayment ? {
        receiptNumber: latestPayment.receiptNumber,
        recordedAt: latestPayment.recordedAt,
        amount: parseFloat(latestPayment.amount),
        method: latestPayment.method,
        notes: latestPayment.notes,
        remainingBalance: parseFloat(latestPayment.remainingBalance),
        recordedBy: latestPayment.recordedBy,
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
      customer: {
        fullName: order.customerName,
        phone: order.phone,
        address: order.address ?? customer?.address ?? "",
      },
      order: {
        id: order.id,
        orderId: order.orderId,
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

ordersRouter.get("/:id/audit-log", async (req: AuthRequest, res) => {
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

ordersRouter.get("/:id/price-adjustments", async (req: AuthRequest, res) => {
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

ordersRouter.post("/:id/price-adjustments", async (req: AuthRequest, res) => {
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
