import { Router } from "express";
import { db } from "@workspace/db";
import { batches, orders } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";

export const batchesRouter = Router();

/**
 * Formats a production-safe batchCode from the database serial `id`.
 *
 * Format: BATCH-YYYYMMDD-NNNN  →  e.g. "BATCH-20260603-0007"
 *
 * Using the serial id eliminates the 9 000-value pool that the old 4-digit
 * random suffix provided.  The PostgreSQL SERIAL is globally unique and
 * monotonically increasing, so collisions are structurally impossible.
 */
function formatBatchCode(serialId: number): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `BATCH-${datePart}-${String(serialId).padStart(4, "0")}`;
}

const batchInputSchema = z.object({
  orderIds: z.array(z.number().int()).min(1),
  assignedWorkerId: z.number().int().optional(),
});

const batchUpdateSchema = z.object({
  status: z.enum(["active", "completed"]).optional(),
});

batchesRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select().from(batches)
      .where(eq(batches.laundryId, laundryId))
      .orderBy(desc(batches.createdAt));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to list batches" });
  }
});

batchesRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [batch] = await db.select().from(batches)
      .where(and(eq(batches.id, parseInt(req.params.id)), eq(batches.laundryId, laundryId)));
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    const batchOrders = await db.select().from(orders)
      .where(and(eq(orders.batchId, batch.id), eq(orders.laundryId, laundryId)));
    res.json({ ...batch, orders: batchOrders });
  } catch (err) {
    res.status(500).json({ error: "Failed to get batch" });
  }
});

batchesRouter.post("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = batchInputSchema.parse(req.body);

    // Two-step insert+update: placeholder satisfies NOT NULL + UNIQUE on insert,
    // then is immediately replaced with the serial-based collision-free code.
    const batch = await db.transaction(async (tx) => {
      const placeholder = `GEN-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [inserted] = await tx.insert(batches).values({
        batchCode: placeholder,
        laundryId,
        orderCount: data.orderIds.length,
      }).returning();

      const finalCode = formatBatchCode(inserted.id);
      await tx.update(batches)
        .set({ batchCode: finalCode })
        .where(eq(batches.id, inserted.id));

      return { ...inserted, batchCode: finalCode };
    });

    for (const orderId of data.orderIds) {
      await db.update(orders).set({
        batchId: batch.id,
        status: "processing",
        assignedWorkerId: data.assignedWorkerId || null,
        updatedAt: new Date(),
      }).where(and(eq(orders.id, orderId), eq(orders.laundryId, laundryId)));
    }

    res.status(201).json(batch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to create batch" });
  }
});

batchesRouter.patch("/:id", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = batchUpdateSchema.parse(req.body);
    const [batch] = await db.update(batches).set(data)
      .where(and(eq(batches.id, parseInt(req.params.id)), eq(batches.laundryId, laundryId)))
      .returning();
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    if (data.status === "completed") {
      await db.update(orders).set({ status: "ready", updatedAt: new Date() })
        .where(and(eq(orders.batchId, batch.id), eq(orders.laundryId, laundryId)));
    }
    res.json(batch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update batch" });
  }
});
