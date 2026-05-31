import { Router } from "express";
import { db } from "@workspace/db";
import { branches } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";

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
      .where(eq(branches.laundryId, laundryId))
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
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId)))
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
    const [deleted] = await db
      .delete(branches)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Branch not found" });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete branch" });
  }
});
