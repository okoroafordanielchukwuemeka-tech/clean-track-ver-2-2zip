import { Router } from "express";
import { db } from "@workspace/db";
import { branches, orders } from "@workspace/db/schema";
import { eq, and, desc, isNull, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { logAction } from "../lib/audit.js";
import { requireOperational, requirePlanLimit } from "../middleware/subscription.js";

export const branchesRouter = Router();

const branchInputSchema = z.object({
  name: z.string().min(1, "Branch name is required"),
  address: z.string().optional(),
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
      .values({ laundryId, ...data })
      .returning();
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
    const [branch] = await db
      .update(branches)
      .set(data)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)))
      .returning();
    if (!branch) return res.status(404).json({ error: "Branch not found" });
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
      .update(branches)
      .set({ deletedAt: new Date() })
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)))
      .returning();
    if (!branch) return res.status(404).json({ error: "Branch not found" });
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
      .where(and(eq(orders.laundryId, laundryId), eq(orders.branchId, id)));

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
