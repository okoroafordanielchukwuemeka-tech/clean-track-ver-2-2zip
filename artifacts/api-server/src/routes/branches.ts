import { Router } from "express";
import { db } from "@workspace/db";
import { branches, orders } from "@workspace/db/schema";
import { eq, and, desc, isNull, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { logAction } from "../lib/audit.js";

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

branchesRouter.post("/", requireOwner, async (req: AuthRequest, res) => {
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

    const [existing] = await db.select().from(branches)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNull(branches.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Branch not found" });

    const liveResult = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM orders
          WHERE branch_id = ${id} AND laundry_id = ${laundryId}
            AND status NOT IN ('completed','cancelled')`
    );
    const liveCount = parseInt((liveResult as any).rows?.[0]?.cnt ?? "0", 10);

    if (liveCount > 0) {
      return res.status(409).json({
        error: `Cannot delete branch — it has ${liveCount} active order(s). Complete or cancel all orders before deleting this branch.`,
        activeOrders: liveCount,
      });
    }

    const auth = req.auth!;
    const now = new Date();
    await db.update(branches).set({
      deletedAt: now,
      deletedById: auth.type === "owner" ? (auth.ownerId ?? null) : (auth.workerId ?? null),
      deletedByType: auth.type,
      deletedByName: auth.name ?? auth.email ?? "unknown",
    }).where(eq(branches.id, id));

    logAction({
      auth,
      laundryId,
      action: "branch_deleted",
      metadata: { branchId: id, branchName: existing.name, address: existing.address },
    }).catch(() => {});

    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete branch" });
  }
});

branchesRouter.post("/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid branch ID" });

    const [existing] = await db.select().from(branches)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNotNull(branches.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Deleted branch not found" });

    const [restored] = await db.update(branches).set({
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
    }).where(eq(branches.id, id)).returning();

    logAction({
      auth: req.auth!,
      laundryId,
      action: "branch_restored",
      metadata: { branchId: id, branchName: existing.name },
    }).catch(() => {});

    res.json(restored);
  } catch {
    res.status(500).json({ error: "Failed to restore branch" });
  }
});
