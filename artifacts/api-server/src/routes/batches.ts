import { Router } from "express";
import { db } from "@workspace/db";
import { batches, orders } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

export const batchesRouter = Router();

function generateBatchCode() {
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `BATCH-${rand}`;
}

const batchInputSchema = z.object({
  orderIds: z.array(z.number().int()).min(1),
  assignedWorkerId: z.number().int().optional(),
});

const batchUpdateSchema = z.object({
  status: z.enum(["active", "completed"]).optional(),
});

batchesRouter.get("/", async (_req, res) => {
  try {
    const result = await db.select().from(batches).orderBy(desc(batches.createdAt));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to list batches" });
  }
});

batchesRouter.get("/:id", async (req, res) => {
  try {
    const [batch] = await db.select().from(batches).where(eq(batches.id, parseInt(req.params.id)));
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    const batchOrders = await db.select().from(orders).where(eq(orders.batchId, batch.id));
    res.json({ ...batch, orders: batchOrders });
  } catch (err) {
    res.status(500).json({ error: "Failed to get batch" });
  }
});

batchesRouter.post("/", async (req, res) => {
  try {
    const data = batchInputSchema.parse(req.body);
    const batchCode = generateBatchCode();

    const [batch] = await db.insert(batches).values({
      batchCode,
      orderCount: data.orderIds.length,
    }).returning();

    for (const orderId of data.orderIds) {
      await db.update(orders).set({
        batchId: batch.id,
        status: "processing",
        assignedWorkerId: data.assignedWorkerId || null,
        updatedAt: new Date(),
      }).where(eq(orders.id, orderId));
    }

    res.status(201).json(batch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to create batch" });
  }
});

batchesRouter.patch("/:id", async (req, res) => {
  try {
    const data = batchUpdateSchema.parse(req.body);
    const [batch] = await db.update(batches).set(data)
      .where(eq(batches.id, parseInt(req.params.id))).returning();
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    if (data.status === "completed") {
      await db.update(orders).set({ status: "ready", updatedAt: new Date() })
        .where(eq(orders.batchId, batch.id));
    }
    res.json(batch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update batch" });
  }
});
