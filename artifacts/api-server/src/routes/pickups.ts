import { Router } from "express";
import { db } from "@workspace/db";
import { pickupRecords, orders, orderItems } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";
import { emitEvent } from "../lib/events.js";

export const pickupsRouter = Router({ mergeParams: true });

const pickupInputSchema = z.object({
  items: z.array(z.object({
    orderItemId: z.number().int(),
    quantity: z.number().int().min(1),
  })).optional(),
  shirtsPickedUp: z.number().int().min(0).optional().default(0),
  trousersPickedUp: z.number().int().min(0).optional().default(0),
  notes: z.string().optional(),
});

pickupsRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const orderId = parseInt(req.params.orderId);

    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.laundryId, laundryId)));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const records = await db.select().from(pickupRecords)
      .where(eq(pickupRecords.orderId, orderId))
      .orderBy(desc(pickupRecords.createdAt));

    res.json(records);
  } catch {
    res.status(500).json({ error: "Failed to list pickups" });
  }
});

pickupsRouter.post("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const orderId = parseInt(req.params.orderId);
    const workerId = req.auth!.type === "worker" ? req.auth!.workerId : undefined;

    const data = pickupInputSchema.parse(req.body);

    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.laundryId, laundryId)));
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (order.status !== "ready" && order.status !== "partial_pickup") {
      return res.status(400).json({ error: "Order must be ready or partially picked up" });
    }

    const totalDue = parseFloat(order.price || "0") + parseFloat(order.extraCharge || "0") - parseFloat(order.discount || "0");
    const amountPaid = parseFloat(order.amountPaid || "0");
    const fullyPaid = totalDue <= 0 || amountPaid >= totalDue;

    const allOrderItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

    let allPickedUp = false;
    let newShirtsPickedUp = order.shirtsPickedUp;
    let newTrousersPickedUp = order.trousersPickedUp;
    let remainingShirts = Math.max(0, order.shirts - order.shirtsPickedUp);
    let remainingTrousers = Math.max(0, order.trousers - order.trousersPickedUp);
    let itemPickupsJson: { orderItemId: number; quantity: number; name: string }[] | null = null;
    let responseItems: { id: number; name: string; quantity: number; quantityPickedUp: number; remaining: number }[] | null = null;

    if (allOrderItems.length > 0) {
      // Item-based order: MUST provide items[] — reject shirts/trousers-only payload
      if (!data.items || data.items.length === 0) {
        return res.status(400).json({ error: "This order uses item-based tracking. Provide items[] to record pickup." });
      }

      for (const itemReq of data.items) {
        const oi = allOrderItems.find(i => i.id === itemReq.orderItemId);
        if (!oi) {
          return res.status(400).json({ error: `Order item ${itemReq.orderItemId} not found on this order` });
        }
        const remaining = oi.quantity - oi.quantityPickedUp;
        if (itemReq.quantity > remaining) {
          return res.status(400).json({ error: `Only ${remaining} of "${oi.name}" remaining to pick up` });
        }
      }

      const updatedPickedUp = new Map(allOrderItems.map(oi => [oi.id, oi.quantityPickedUp]));
      for (const itemReq of data.items) {
        const oi = allOrderItems.find(i => i.id === itemReq.orderItemId)!;
        const newQty = oi.quantityPickedUp + itemReq.quantity;
        await db.update(orderItems).set({ quantityPickedUp: newQty }).where(eq(orderItems.id, oi.id));
        updatedPickedUp.set(oi.id, newQty);
      }

      allPickedUp = allOrderItems.every(oi => (updatedPickedUp.get(oi.id) ?? 0) >= oi.quantity);

      itemPickupsJson = data.items.map(req => {
        const oi = allOrderItems.find(i => i.id === req.orderItemId)!;
        return { orderItemId: req.orderItemId, quantity: req.quantity, name: oi.name };
      });

      responseItems = allOrderItems.map(oi => {
        const newPickedUp = updatedPickedUp.get(oi.id) ?? 0;
        return { id: oi.id, name: oi.name, quantity: oi.quantity, quantityPickedUp: newPickedUp, remaining: Math.max(0, oi.quantity - newPickedUp) };
      });
    } else {
      // Legacy shirts/trousers-based order
      if ((data.shirtsPickedUp ?? 0) === 0 && (data.trousersPickedUp ?? 0) === 0) {
        return res.status(400).json({ error: "At least one item must be picked up" });
      }

      newShirtsPickedUp = Math.min(order.shirtsPickedUp + (data.shirtsPickedUp ?? 0), order.shirts);
      newTrousersPickedUp = Math.min(order.trousersPickedUp + (data.trousersPickedUp ?? 0), order.trousers);
      remainingShirts = Math.max(0, order.shirts - newShirtsPickedUp);
      remainingTrousers = Math.max(0, order.trousers - newTrousersPickedUp);
      allPickedUp = remainingShirts <= 0 && remainingTrousers <= 0;
    }

    const newStatus = allPickedUp && fullyPaid ? "completed" : "partial_pickup";

    const [pickup] = await db.insert(pickupRecords).values({
      laundryId,
      orderId,
      shirtsPickedUp: data.shirtsPickedUp ?? 0,
      trousersPickedUp: data.trousersPickedUp ?? 0,
      itemPickups: itemPickupsJson,
      notes: data.notes,
      processedBy: workerId,
    }).returning();

    await db.update(orders).set({
      shirtsPickedUp: newShirtsPickedUp,
      trousersPickedUp: newTrousersPickedUp,
      status: newStatus,
      updatedAt: new Date(),
    }).where(eq(orders.id, orderId));

    if (newStatus === "completed") {
      emitEvent({
        laundryId,
        eventType: "pickup_completed",
        title: "Order Completed",
        message: `Order #${order.orderId} for ${order.customerName} — all items picked up${fullyPaid ? " and fully paid" : ""}.`,
        severity: "success",
        relatedOrderId: order.id,
      }).catch(() => {});
    } else {
      const itemsMsg = responseItems
        ? `${responseItems.reduce((s, i) => s + i.remaining, 0)} item(s) still remaining`
        : `${remainingShirts}S / ${remainingTrousers}T remaining`;
      emitEvent({
        laundryId,
        eventType: "partial_pickup",
        title: "Partial Pickup Recorded",
        message: `Order #${order.orderId} (${order.customerName}): ${itemsMsg}.${!fullyPaid ? ` Balance: ₦${Math.max(0, parseFloat(order.price || "0") + parseFloat(order.extraCharge || "0") - parseFloat(order.discount || "0") - parseFloat(order.amountPaid || "0")).toLocaleString()}.` : ""}`,
        severity: "info",
        relatedOrderId: order.id,
      }).catch(() => {});
    }

    res.status(201).json({
      pickup,
      order: {
        status: newStatus,
        shirtsPickedUp: newShirtsPickedUp,
        trousersPickedUp: newTrousersPickedUp,
        remainingShirts,
        remainingTrousers,
        allPickedUp,
        fullyPaid,
        items: responseItems,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to record pickup" });
  }
});
