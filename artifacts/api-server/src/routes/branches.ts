import { Router } from "express";
import { db } from "@workspace/db";
import { branches, orders, workers } from "@workspace/db/schema";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { requireOperational, requirePlanLimit } from "../middleware/subscription.js";
import { trackActivationEvent } from "../lib/activation-tracker.js";

export const branchesRouter = Router();

const branchInputSchema = z.object({
  name: z.string().min(1, "Branch name is required"),
  address: z.string().optional(),
});

/**
 * Branches are organizational locations only.
 *
 * CleanTrack no longer models Pickup/Processing/Hybrid capabilities or
 * automatic branch-to-branch routing. An order belongs to the branch where
 * it was created. Owners can give a worker cross-branch order access through
 * Worker Permissions when that worker needs to operate orders from elsewhere.
 */
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
      .values({
        laundryId,
        name: data.name,
        address: data.address ?? null,
        // Keep the legacy column normalized while the database migration
        // retires the old capability values.
        type: "HYBRID",
        processingDestinationBranchId: null,
      })
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

    const [updated] = await db
      .update(branches)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        type: "HYBRID",
        processingDestinationBranchId: null,
      })
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)))
      .returning();

    res.json(updated);
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
        eq(orders.branchId, id),
        sql`${orders.status} NOT IN ('completed','cancelled')`
      ));
    if (Number(activeOrders?.count ?? 0) > 0) {
      return res.status(409).json({ error: "Cannot delete a branch that still has active orders. Complete those orders first." });
    }

    const [activeWorkers] = await db
      .select({ count: sql<number>`count(*)` })
      .from(workers)
      .where(and(
        eq(workers.laundryId, laundryId),
        eq(workers.branchId, id),
        eq(workers.isActive, true),
        isNull(workers.deletedAt)
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
      .select({
        id: orders.id,
        branchId: orders.branchId,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.laundryId, laundryId));

    res.json(activeBranches.map(branch => {
      const current = branchOrders.filter(o => o.branchId === branch.id && !["completed", "cancelled"].includes(o.status));
      return {
        id: branch.id,
        name: branch.name,
        // Legacy response fields are retained for old clients but no longer
        // drive any operational behavior.
        type: "HYBRID",
        processingDestinationBranchId: null,
        counts: {
          active: current.length,
          incoming: 0,
          local: current.length,
          processing: current.filter(o => o.status === "processing").length,
          ready: current.filter(o => o.status === "ready").length,
          awaitingTransfer: 0,
        },
      };
    }));
  } catch (err) {
    console.error("[branches] Failed to build branch summary:", err);
    res.status(500).json({ error: "Failed to load branch summary" });
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
      .where(and(eq(orders.laundryId, laundryId), eq(orders.branchId, id)));

    res.json({
      branch,
      stats: {
        totalOrders: branchOrders.length,
        pendingOrders: branchOrders.filter(o => o.status === "pending").length,
        processingOrders: branchOrders.filter(o => o.status === "processing").length,
        readyOrders: branchOrders.filter(o => o.status === "ready").length,
        completedOrders: branchOrders.filter(o => o.status === "completed").length,
        revenue: branchOrders.reduce((s, o) => s + parseFloat(o.price || "0"), 0),
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to get branch stats" });
  }
});
