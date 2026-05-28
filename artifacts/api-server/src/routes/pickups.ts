import { Router } from "express";
import { db } from "@workspace/db";
import { pickupRecords, orders } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";

export const pickupsRouter = Router({ mergeParams: true });

const pickupInputSchema = z.object({
  shirtsPickedUp: z.number().int().min(0).default(0),
  trousersPickedUp: z.number().int().min(0).default(0),
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

    if (data.shirtsPickedUp === 0 && data.trousersPickedUp === 0) {
      return res.status(400).json({ error: "At least one item must be picked up" });
    }

    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.laundryId, laundryId)));
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (order.status !== "ready" && order.status !== "partial_pickup") {
      return res.status(400).json({ error: "Order must be ready or partially picked up before recording a pickup" });
    }

    const currentShirtsPickedUp = (order.shirtsPickedUp ?? 0) + data.shirtsPickedUp;
    const currentTrousersPickedUp = (order.trousersPickedUp ?? 0) + data.trousersPickedUp;

    const maxShirts = Math.min(currentShirtsPickedUp, order.shirts);
    const maxTrousers = Math.min(currentTrousersPickedUp, order.trousers);

    const remainingShirts = order.shirts - maxShirts;
    const remainingTrousers = order.trousers - maxTrousers;
    const allPickedUp = remainingShirts <= 0 && remainingTrousers <= 0;

    const totalDue = parseFloat(order.price || "0") + parseFloat(order.extraCharge || "0") - parseFloat(order.discount || "0");
    const amountPaid = parseFloat(order.amountPaid || "0");
    const fullyPaid = totalDue <= 0 || amountPaid >= totalDue;

    const newStatus = allPickedUp && fullyPaid ? "completed" : "partial_pickup";

    const [pickup] = await db.insert(pickupRecords).values({
      laundryId,
      orderId,
      shirtsPickedUp: data.shirtsPickedUp,
      trousersPickedUp: data.trousersPickedUp,
      notes: data.notes,
      processedBy: workerId,
    }).returning();

    await db.update(orders).set({
      shirtsPickedUp: maxShirts,
      trousersPickedUp: maxTrousers,
      status: newStatus,
      updatedAt: new Date(),
    }).where(eq(orders.id, orderId));

    res.status(201).json({
      pickup,
      order: {
        status: newStatus,
        shirtsPickedUp: maxShirts,
        trousersPickedUp: maxTrousers,
        remainingShirts,
        remainingTrousers,
        allPickedUp,
        fullyPaid,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to record pickup" });
  }
});
