import { Router } from "express";
import { db } from "@workspace/db";
import { batches, orders } from "@workspace/db/schema";
import { eq, desc, and, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

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

/**
 * Returns the batch IDs visible to the caller.
 * Workers (branchId set) only see batches that contain at least one
 * order from their assigned branch.  Owners see all batches.
 */
async function getVisibleBatchIds(laundryId: number, workerBranchId: number | undefined): Promise<number[] | null> {
  if (!workerBranchId) return null; // owner — no restriction

  const rows = await db
    .selectDistinct({ batchId: orders.batchId })
    .from(orders)
    .where(
      and(
        eq(orders.laundryId, laundryId),
        eq(orders.branchId, workerBranchId),
        isNotNull(orders.batchId)
      )
    );
  return rows.map((r) => r.batchId!).filter(Boolean);
}

// ── GET /batches ─────────────────────────────────────────────────────────────
batchesRouter.get("/", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;

    const visibleIds = await getVisibleBatchIds(laundryId, workerBranchId);
    if (visibleIds !== null && visibleIds.length === 0) {
      return res.json([]);
    }

    const conditions: any[] = [eq(batches.laundryId, laundryId)];
    if (visibleIds !== null) conditions.push(inArray(batches.id, visibleIds));

    const result = await db
      .select()
      .from(batches)
      .where(and(...conditions))
      .orderBy(desc(batches.createdAt));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to list batches" });
  }
});

// ── GET /batches/:id ─────────────────────────────────────────────────────────
batchesRouter.get("/:id", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const batchId = parseInt(req.params.id);

    const conditions: any[] = [eq(batches.id, batchId), eq(batches.laundryId, laundryId)];

    // Workers: verify they can see this batch (it has orders in their branch)
    if (workerBranchId) {
      const visibleIds = await getVisibleBatchIds(laundryId, workerBranchId);
      if (!visibleIds || !visibleIds.includes(batchId)) {
        return res.status(404).json({ error: "Batch not found" });
      }
    }

    const [batch] = await db.select().from(batches).where(and(...conditions));
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    // Workers: only include orders from their branch in the batch detail
    const orderConditions: any[] = [eq(orders.batchId, batch.id), eq(orders.laundryId, laundryId)];
    if (workerBranchId) orderConditions.push(eq(orders.branchId, workerBranchId));
    const batchOrders = await db.select().from(orders).where(and(...orderConditions));

    res.json({ ...batch, orders: batchOrders });
  } catch (err) {
    res.status(500).json({ error: "Failed to get batch" });
  }
});

// ── POST /batches ─────────────────────────────────────────────────────────────
batchesRouter.post("/", checkPermission("process:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const data = batchInputSchema.parse(req.body);

    // Workers: verify every order in the batch belongs to their branch
    if (workerBranchId) {
      const branchOrders = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            inArray(orders.id, data.orderIds),
            eq(orders.laundryId, laundryId),
            eq(orders.branchId, workerBranchId)
          )
        );
      if (branchOrders.length !== data.orderIds.length) {
        return res.status(403).json({ error: "One or more orders do not belong to your branch" });
      }
    }

    // Two-step insert+update: placeholder satisfies NOT NULL + UNIQUE on insert,
    // then is immediately replaced with the serial-based collision-free code.
    const batch = await db.transaction(async (tx) => {
      const placeholder = `GEN-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [inserted] = await tx
        .insert(batches)
        .values({
          batchCode: placeholder,
          laundryId,
          orderCount: data.orderIds.length,
        })
        .returning();

      const finalCode = formatBatchCode(inserted.id);
      await tx.update(batches).set({ batchCode: finalCode }).where(eq(batches.id, inserted.id));

      return { ...inserted, batchCode: finalCode };
    });

    for (const orderId of data.orderIds) {
      const orderConditions: any[] = [eq(orders.id, orderId), eq(orders.laundryId, laundryId)];
      if (workerBranchId) orderConditions.push(eq(orders.branchId, workerBranchId));
      await db
        .update(orders)
        .set({
          batchId: batch.id,
          status: "processing",
          assignedWorkerId: data.assignedWorkerId || null,
          updatedAt: new Date(),
        })
        .where(and(...orderConditions));
    }

    res.status(201).json(batch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to create batch" });
  }
});

// ── PATCH /batches/:id ────────────────────────────────────────────────────────
batchesRouter.patch("/:id", checkPermission("process:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const batchId = parseInt(req.params.id);
    const data = batchUpdateSchema.parse(req.body);

    // Workers: verify they can access this batch
    if (workerBranchId) {
      const visibleIds = await getVisibleBatchIds(laundryId, workerBranchId);
      if (!visibleIds || !visibleIds.includes(batchId)) {
        return res.status(404).json({ error: "Batch not found" });
      }
    }

    const [batch] = await db
      .update(batches)
      .set(data)
      .where(and(eq(batches.id, batchId), eq(batches.laundryId, laundryId)))
      .returning();
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    if (data.status === "completed") {
      const orderConditions: any[] = [eq(orders.batchId, batch.id), eq(orders.laundryId, laundryId)];
      if (workerBranchId) orderConditions.push(eq(orders.branchId, workerBranchId));
      await db.update(orders).set({ status: "ready", updatedAt: new Date() }).where(and(...orderConditions));
    }
    res.json(batch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update batch" });
  }
});
