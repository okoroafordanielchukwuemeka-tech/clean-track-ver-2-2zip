import { Router } from "express";
import { db } from "@workspace/db";
import { batches, orders, workers, branches } from "@workspace/db/schema";
import { eq, desc, and, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { idempotencyMiddleware } from "../lib/idempotency.js";

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
  orderIds: z.array(z.number().int()).min(1).refine(ids => new Set(ids).size === ids.length, { message: "orderIds must not contain duplicates" }),
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
        eq(orders.currentBranchId, workerBranchId),
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
batchesRouter.post("/", checkPermission("process:orders"), idempotencyMiddleware, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const data = batchInputSchema.parse(req.body);

    if (data.assignedWorkerId !== undefined) {
      const [worker] = await db.select({ id: workers.id, laundryId: workers.laundryId, branchId: workers.branchId }).from(workers).where(eq(workers.id, data.assignedWorkerId));
      if (!worker || worker.laundryId !== laundryId) return res.status(403).json({ error: "Assigned worker does not belong to this laundry" });
      if (workerBranchId && worker.branchId !== workerBranchId) return res.status(403).json({ error: "Workers can only assign batches to workers in their branch" });
    }
    const batch = await db.transaction(async (tx) => {
      const conditions:any[]=[inArray(orders.id,data.orderIds),eq(orders.laundryId,laundryId)];
      if(workerBranchId) conditions.push(eq(orders.branchId,workerBranchId));
      const targets=await tx.select({ id: orders.id, status: orders.status, batchId: orders.batchId, processingBranchId: orders.processingBranchId, currentBranchId: orders.currentBranchId }).from(orders).where(and(...conditions));
      if(targets.length!==data.orderIds.length) throw new Error("BATCH_ORDER_SCOPE");
      if(targets.some(o => o.processingBranchId == null || o.currentBranchId !== o.processingBranchId)) throw new Error("BATCH_NOT_AT_PROCESSING_BRANCH");
      const processingBranchIds = [...new Set(targets.map(o => o.processingBranchId!).filter(Boolean))];
      if(processingBranchIds.length !== 1) throw new Error("BATCH_MIXED_PROCESSING_BRANCHES");
      const [processingBranch] = await tx.select({ id: branches.id, type: branches.type }).from(branches).where(and(eq(branches.id, processingBranchIds[0]), eq(branches.laundryId, laundryId), eq(branches.deletedAt, null)));
      if(!processingBranch || !["PROCESSING", "HYBRID"].includes(processingBranch.type)) throw new Error("BATCH_PROCESSING_CAPABILITY");
      if(targets.some(o=>o.status==="cancelled"||o.status==="completed"||o.batchId!==null)) throw new Error("BATCH_ORDER_STATE");
      const placeholder=`GEN-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [inserted]=await tx.insert(batches).values({batchCode:placeholder,laundryId,orderCount:data.orderIds.length}).returning();
      const finalCode=formatBatchCode(inserted.id);
      const [finalBatch]=await tx.update(batches).set({batchCode:finalCode}).where(eq(batches.id,inserted.id)).returning();
      await tx.update(orders).set({batchId:inserted.id,status:"processing",assignedWorkerId:data.assignedWorkerId??null,updatedAt:new Date()}).where(and(...conditions));
      return finalBatch;
    });
    res.status(201).json(batch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    if (err instanceof Error && err.message === "BATCH_ORDER_SCOPE") return res.status(403).json({ error: "One or more orders do not belong to this laundry or branch" });
    if (err instanceof Error && err.message === "BATCH_ORDER_STATE") return res.status(409).json({ error: "One or more orders are already batched, completed, or cancelled" });
    if (err instanceof Error && err.message === "BATCH_NOT_AT_PROCESSING_BRANCH") return res.status(409).json({ error: "One or more orders are not currently at their assigned processing branch" });
    if (err instanceof Error && err.message === "BATCH_MIXED_PROCESSING_BRANCHES") return res.status(400).json({ error: "A batch cannot combine orders assigned to different processing branches" });
    if (err instanceof Error && err.message === "BATCH_PROCESSING_CAPABILITY") return res.status(400).json({ error: "The processing branch cannot process orders" });
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

    const batch = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(batches).where(and(eq(batches.id,batchId),eq(batches.laundryId,laundryId)));
      if(!current) return null;
      if(data.status===current.status) return current;
      if(data.status==="active" && current.status==="completed") throw new Error("BATCH_TERMINAL");
      if(data.status==="completed"){
        const conditions:any[]=[eq(orders.batchId,current.id),eq(orders.laundryId,laundryId)];
        if(workerBranchId) conditions.push(eq(orders.branchId,workerBranchId));
        await tx.update(orders).set({status:"ready",updatedAt:new Date()}).where(and(...conditions,eq(orders.status,"processing")));
      }
      const [updated]=await tx.update(batches).set(data).where(and(eq(batches.id,batchId),eq(batches.laundryId,laundryId))).returning();
      return updated;
    });
    if(!batch) return res.status(404).json({error:"Batch not found"});
    res.json(batch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    if (err instanceof Error && err.message === "BATCH_TERMINAL") return res.status(409).json({ error: "A completed batch cannot be reopened" });
    res.status(500).json({ error: "Failed to update batch" });
  }
});
