import { Router } from "express";
import { db } from "@workspace/db";
import { orders, paymentRecords, orderItems, customers, laundries, services, priceAdjustments } from "@workspace/db/schema";
import { eq, desc, and, count, inArray } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";
import { emitEvent } from "../lib/events.js";

export const ordersRouter = Router();

const DEFAULT_TURNAROUND: Record<string, number> = { express: 24, premium: 48, standard: 72 };

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

const orderUpdateSchema = z.object({
  status: z.enum(["pending", "processing", "ready", "partial_pickup", "completed"]).optional(),
  paymentStatus: z.enum(["unpaid", "partial", "paid"]).optional(),
  price: z.number().optional(),
  extraCharge: z.number().optional(),
  discount: z.number().optional(),
  verifiedShirts: z.number().int().optional(),
  verifiedTrousers: z.number().int().optional(),
  isVerified: z.boolean().optional(),
  additionalNotes: z.string().optional(),
  assignedWorkerId: z.number().int().nullable().optional(),
});

ordersRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { status, paymentStatus, limit = "50", offset = "0" } = req.query;
    const conditions: any[] = [eq(orders.laundryId, laundryId)];
    if (status) conditions.push(eq(orders.status, status as string));
    if (paymentStatus) conditions.push(eq(orders.paymentStatus, paymentStatus as string));

    const result = await db.select().from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt))
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string));

    if (result.length === 0) return res.json([]);

    const orderIds = result.map(o => o.id);
    const itemCounts = await db
      .select({ orderId: orderItems.orderId, n: count(orderItems.id) })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .groupBy(orderItems.orderId);

    const countMap: Record<number, number> = {};
    for (const row of itemCounts) {
      if (row.orderId !== null) countMap[row.orderId] = Number(row.n);
    }

    res.json(result.map(o => ({ ...o, itemCount: countMap[o.id] ?? 0 })));
  } catch {
    res.status(500).json({ error: "Failed to list orders" });
  }
});

ordersRouter.get("/summary", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select().from(orders).where(eq(orders.laundryId, laundryId));
    const now = new Date();
    const summary = {
      total: result.length,
      pending: result.filter(o => o.status === "pending").length,
      processing: result.filter(o => o.status === "processing").length,
      ready: result.filter(o => o.status === "ready").length,
      partialPickup: result.filter(o => o.status === "partial_pickup").length,
      completed: result.filter(o => o.status === "completed").length,
      unpaid: result.filter(o => o.paymentStatus === "unpaid").length,
      partial: result.filter(o => o.paymentStatus === "partial").length,
      paid: result.filter(o => o.paymentStatus === "paid").length,
      totalRevenue: result.reduce((sum, o) => sum + parseFloat(o.price || "0"), 0),
      pendingRevenue: result.filter(o => o.paymentStatus !== "paid")
        .reduce((sum, o) => sum + parseFloat(o.price || "0") - parseFloat(o.amountPaid || "0"), 0),
      collectedRevenue: result.reduce((sum, o) => sum + parseFloat(o.amountPaid || "0"), 0),
      overdueCount: result.filter(o => {
        if (["completed"].includes(o.status)) return false;
        if (o.processingDueAt) return new Date(o.processingDueAt) < now;
        const h = DEFAULT_TURNAROUND[o.serviceType] ?? 72;
        return new Date(new Date(o.createdAt).getTime() + h * 3600000) < now;
      }).length,
    };
    res.json(summary);
  } catch {
    res.status(500).json({ error: "Failed to get summary" });
  }
});

ordersRouter.get("/recent", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select().from(orders)
      .where(eq(orders.laundryId, laundryId))
      .orderBy(desc(orders.createdAt))
      .limit(10);
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to get recent orders" });
  }
});

ordersRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)));
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
    const data = orderInputSchema.parse(req.body);
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
      await db.update(customers).set({ lastActivityAt: new Date() }).where(eq(customers.id, customerId));
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

    const [order] = await db.insert(orders).values({
      laundryId,
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
    const appliedBy = req.auth?.name ?? req.auth?.email ?? "system";

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

    res.status(201).json({ ...order, items: insertedItems });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to create order" });
  }
});

ordersRouter.patch("/:id", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = orderUpdateSchema.parse(req.body);
    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.price !== undefined) updateData.price = data.price?.toString();
    if (data.extraCharge !== undefined) updateData.extraCharge = data.extraCharge?.toString();
    if (data.discount !== undefined) updateData.discount = data.discount?.toString();

    const [beforeOrder] = await db.select().from(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)));

    const [order] = await db.update(orders).set(updateData)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)))
      .returning();
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (beforeOrder) {
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

    res.json(order);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update order" });
  }
});

ordersRouter.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [deleted] = await db.delete(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Order not found" });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete order" });
  }
});

ordersRouter.get("/:id/payments", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)));
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
    const paymentSchema = z.object({
      amount: z.number().min(0.01),
      method: z.enum(["cash", "transfer", "pos"]).default("cash"),
      notes: z.string().optional(),
    });
    const data = paymentSchema.parse(req.body);
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const price = parseFloat(order.price || "0");
    const extraCharge = parseFloat(order.extraCharge || "0");
    const discount = parseFloat(order.discount || "0");
    const totalDue = price + extraCharge - discount;
    const amountPaid = parseFloat(order.amountPaid || "0") + data.amount;
    const remainingBalance = Math.max(0, totalDue - amountPaid);
    const paymentStatus = remainingBalance <= 0 ? "paid" : amountPaid > 0 ? "partial" : "unpaid";

    const [payment] = await db.insert(paymentRecords).values({
      orderId: order.id,
      amount: data.amount.toString(),
      method: data.method,
      notes: data.notes,
      remainingBalance: remainingBalance.toString(),
    }).returning();

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

    res.status(201).json(payment);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to record payment" });
  }
});

ordersRouter.delete("/:id/payments/:paymentId", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)));
    if (!order) return res.status(404).json({ error: "Order not found" });
    const [deleted] = await db.delete(paymentRecords)
      .where(eq(paymentRecords.id, parseInt(req.params.paymentId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Payment not found" });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete payment" });
  }
});

ordersRouter.get("/:id/items", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)));
    if (!order) return res.status(404).json({ error: "Order not found" });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    res.json(items);
  } catch {
    res.status(500).json({ error: "Failed to list order items" });
  }
});

ordersRouter.post("/:id/items", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
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
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)));
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

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    res.json({ ...updated, items });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to add order items" });
  }
});

ordersRouter.get("/:id/price-adjustments", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)));
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
    const schema = z.object({
      type: z.enum(["discount", "extra_charge"]),
      amount: z.number().positive(),
      reason: z.string().min(1, "Reason is required"),
    });
    const data = schema.parse(req.body);

    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, parseInt(req.params.id)), eq(orders.laundryId, laundryId)));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const appliedBy = req.auth?.name ?? req.auth?.email ?? "system";
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

    res.status(201).json(adjustment);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to add price adjustment" });
  }
});
