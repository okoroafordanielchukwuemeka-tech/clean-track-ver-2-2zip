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
  processingDestinationBranchId: z.number().int().positive().nullable().optional(),
});

async function validateProcessingDestination(laundryId: number, branchId: number, destinationId: number | null | undefined) {
  if (destinationId == null) return;
  if (destinationId === branchId) throw new Error("PROCESSING_DESTINATION_SELF");
  const [destination] = await db
    .select({ id: branches.id, type: branches.type })
    .from(branches)
    .where(and(eq(branches.id, destinationId), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)));
  if (!destination) throw new Error("PROCESSING_DESTINATION_NOT_FOUND");
  if (!["PROCESSING", "HYBRID"].includes(destination.type)) throw new Error("PROCESSING_DESTINATION_INVALID_TYPE");
}

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
    const type = data.type ?? "HYBRID";
    if (type === "PICKUP" && data.processingDestinationBranchId == null) {
      return res.status(400).json({ error: "Pickup branches must have a processing destination configured" });
    }
    if (type !== "PICKUP" && data.processingDestinationBranchId != null) {
      return res.status(400).json({ error: "Only Pickup branches can have a processing destination" });
    }
    try {
      await validateProcessingDestination(laundryId, 0, data.processingDestinationBranchId);
    } catch (err) {
      if (err instanceof Error && err.message === "PROCESSING_DESTINATION_NOT_FOUND") return res.status(400).json({ error: "Processing destination branch not found" });
      if (err instanceof Error && err.message === "PROCESSING_DESTINATION_INVALID_TYPE") return res.status(400).json({ error: "Processing destination must be a Processing or Hybrid branch" });
      throw err;
    }
    const [branch] = await db
      .insert(branches)
      .values({ laundryId, ...data, type, processingDestinationBranchId: data.processingDestinationBranchId ?? null })
      .returning();
    trackActivationEvent(laundryId, "branch_created");
    res.status(201).json(branch);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    console.error("[branches] Failed to create branch:", err);
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

    const nextType = data.type ?? existing.type;
    const nextDestination = data.processingDestinationBranchId !== undefined
      ? data.processingDestinationBranchId
      : existing.processingDestinationBranchId;

    if (nextType === "PICKUP" && nextDestination == null) {
      return res.status(400).json({ error: "Pickup branches must have a processing destination configured" });
    }
    if (nextType !== "PICKUP" && nextDestination != null) {
      return res.status(400).json({ error: "Only Pickup branches can have a processing destination" });
    }

    try {
      await validateProcessingDestination(laundryId, id, nextDestination);
    } catch (err) {
      if (err instanceof Error && err.message === "PROCESSING_DESTINATION_SELF") return res.status(400).json({ error: "A branch cannot be its own processing destination" });
      if (err instanceof Error && err.message === "PROCESSING_DESTINATION_NOT_FOUND") return res.status(400).json({ error: "Processing destination branch not found" });
      if (err instanceof Error && err.message === "PROCESSING_DESTINATION_INVALID_TYPE") return res.status(400).json({ error: "Processing destination must be a Processing or Hybrid branch" });
      throw err;
    }

    if (existing.processingDestinationBranchId !== nextDestination) {
      const [dependentOrders] = await db.select({ count: sql<number>`count(*)` }).from(orders).where(and(
        eq(orders.laundryId, laundryId),
        eq(orders.collectionBranchId, id),
        eq(orders.processingBranchId, existing.processingDestinationBranchId ?? -1),
        sql`${orders.status} NOT IN ('completed','cancelled')`
      ));
      if (Number(dependentOrders?.count ?? 0) > 0) {
        return res.status(409).json({ error: "Cannot change processing destination while active orders still depend on the current route" });
      }
    }

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

    const updateData = { ...data, type: nextType, processingDestinationBranchId: nextDestination ?? null };
    const [branch] = await db
      .update(branches)
      .set(updateData)
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

    const [dependentBranches] = await db.select({ count: sql<number>`count(*)` }).from(branches).where(and(
      eq(branches.laundryId, laundryId),
      eq(branches.processingDestinationBranchId, id),
      isNull(branches.deletedAt)
    ));
    if (Number(dependentBranches?.count ?? 0) > 0) {
      return res.status(409).json({ error: "Cannot delete a branch used as a processing destination. Reconfigure those Pickup branches first." });
    }

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

branchesRouter.get("/network-summary", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const activeBranches = await db
      .select()
      .from(branches)
      .where(and(eq(branches.laundryId, laundryId), isNull(branches.deletedAt)))
      .orderBy(desc(branches.createdAt));

    const branchOrders = await db
      .select()
      .from(orders)
      .where(and(eq(orders.laundryId, laundryId), isNull(orders.deletedAt)));

    const summary = activeBranches.map(branch => {
      const current = branchOrders.filter(o => o.currentBranchId === branch.id && !["completed", "cancelled"].includes(o.status));
      const incoming = current.filter(o =>
        o.collectionBranchId !== branch.id &&
        o.processingBranchId === branch.id &&
        o.status === "pending"
      );
      const local = current.filter(o =>
        o.collectionBranchId === branch.id &&
        o.processingBranchId === branch.id
      );
      const processing = current.filter(o => o.currentBranchId === branch.id && o.processingBranchId === branch.id && o.status === "processing");
      const ready = current.filter(o => o.currentBranchId === branch.id && o.status === "ready");
      const awaitingTransfer = branch.type !== "PROCESSING"
        ? current.filter(o => o.currentBranchId === branch.id && o.collectionBranchId === branch.id && o.processingBranchId !== branch.id)
        : [];

      return {
        id: branch.id,
        name: branch.name,
        type: branch.type,
        processingDestinationBranchId: branch.processingDestinationBranchId,
        counts: {
          active: current.length,
          incoming: incoming.length,
          local: local.length,
          processing: processing.length,
          ready: ready.length,
          awaitingTransfer: awaitingTransfer.length,
        },
      };
    });

    res.json(summary);
  } catch (err) {
    console.error("[branches] Failed to build network summary:", err);
    res.status(500).json({ error: "Failed to load branch network summary" });
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
