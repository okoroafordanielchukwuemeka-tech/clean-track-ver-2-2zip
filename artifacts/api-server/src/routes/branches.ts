import { Router } from "express";
import { db } from "@workspace/db";
import { branches, orders, workers } from "@workspace/db/schema";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { requireOperational, requirePlanLimit } from "../middleware/subscription.js";
import { trackActivationEvent } from "../lib/activation-tracker.js";

export const branchesRouter = Router();

const branchTypeSchema = z.enum(["PROCESSING", "PICKUP", "HYBRID"]);

const branchInputSchema = z.object({
  name: z.string().min(1, "Branch name is required"),
  address: z.string().optional(),
  type: branchTypeSchema.optional(),
});

branchesRouter.get("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db
      .select()
      .from(branches)
      .where(and(eq(branches.laundryId, laundryId), isNull(branches.deletedAt)))
      .orderBy(desc(branches.createdAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list branches" });
  }
});

branchesRouter.post("/", requireOwner, requireOperational, requirePlanLimit("branches"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = branchInputSchema.parse(req.body);
    const [branch] = await db
      .insert(branches)
      .values({ laundryId, ...data, type: data.type ?? "HYBRID" })
      .returning();
    trackActivationEvent(laundryId, "branch_created");
    res.status(201).json(branch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to create branch" });
  }
});

branchesRouter.patch("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid branch ID" });
    const data = branchInputSchema.partial().parse(req.body);

    const [existing] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Branch not found" });

    // Branch type is intentionally editable by the owner. The type describes what
    // this physical location is capable of doing today. We block unsafe capability
    // changes while active orders still depend on the old capability.
    if (data.type && data.type !== existing.type) {
      const [usage] = await db
        .select({
          collection: sql<number>`count(*) filter (where collection_branch_id = ${id} and status not in ('completed','cancelled'))`,
          processing: sql<number>`count(*) filter (where processing_branch_id = ${id} and status not in ('completed','cancelled'))`,
          returning: sql<number>`count(*) filter (where return_branch_id = ${id} and status not in ('completed','cancelled'))`,
        })
        .from(orders)
        .where(eq(orders.laundryId, laundryId));

      const collection = Number(usage?.collection ?? 0);
      const processing = Number(usage?.processing ?? 0);
      const returning = Number(usage?.returning ?? 0);

      const canCollect = data.type === "PICKUP" || data.type === "HYBRID";
      const canProcess = data.type === "PROCESSING" || data.type === "HYBRID";
      const canReturn = data.type === "PICKUP" || data.type === "HYBRID";

      if (!canCollect && collection > 0) {
        return res.status(409).json({ error: "Cannot remove collection capability while active orders use this branch for collection" });
      }
      if (!canProcess && processing > 0) {
        return res.status(409).json({ error: "Cannot remove processing capability while active orders use this branch for processing" });
      }
      if (!canReturn && returning > 0) {
        return res.status(409).json({ error: "Cannot remove return capability while active orders use this branch for returns" });
      }
    }

    const [branch] = await db
      .update(branches)
      .set(data)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)))
      .returning();
    res.json(branch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update branch" });
  }
});

branchesRouter.delete("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid branch ID" });
    const [branch] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)));
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const [activeOrders] = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(and(
        eq(orders.laundryId, laundryId),
        sql`(${orders.collectionBranchId} = ${id} OR ${orders.processingBranchId} = ${id} OR ${orders.returnBranchId} = ${id} OR ${orders.currentBranchId} = ${id})`,
        sql`${orders.status} NOT IN ('completed','cancelled')`
      ));

    if (Number(activeOrders?.count ?? 0) > 0) {
      return res.status(409).json({ error: "Cannot delete a branch that still has active orders. Move or complete those orders first." });
    }

    const [activeWorkers] = await db
      .select({ count: sql<number>`count(*)` })
      .from(workers)
      .where(and(
        eq(workers.laundryId, laundryId),
        eq(workers.branchId, id),
        eq(workers.isActive, true)
      ));

    if (Number(activeWorkers?.count ?? 0) > 0) {
      return res.status(409).json({ error: "Cannot delete a branch that still has active workers. Reassign those workers first." });
    }

    const [deleted] = await db
      .update(branches)
      .set({ deletedAt: new Date() })
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Branch not found" });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete branch" });
  }
});

branchesRouter.get("/:id/stats", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid branch ID" });

    const [branch] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)));
    if (!branch) return res.status(404).json({ error: "Branch not found" });

    const branchOrders = await db
      .select()
      .from(orders)
      .where(and(eq(orders.laundryId, laundryId), eq(orders.currentBranchId, id)));

    res.json({
      branch,
      stats: {
        totalOrders: branchOrders.length,
        pendingOrders: branchOrders.filter(o => o.status === "pending").length,
        completedOrders: branchOrders.filter(o => o.status === "completed").length,
        revenue: branchOrders.reduce((s, o) => s + parseFloat(o.price || "0"), 0),
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to get branch stats" });
  }
});
