import { Router } from "express";
import { db } from "@workspace/db";
import { expenseCategories } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { requireEntitlement } from "../middleware/subscription.js";

export const expenseCategoriesRouter = Router();
expenseCategoriesRouter.use(requireEntitlement("HAS_EXPENSE_TRACKING"));

const categorySchema = z.object({
  name: z.string().min(1, "Category name required").max(50),
  isActive: z.boolean().optional(),
});

expenseCategoriesRouter.get("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const result = await db.select().from(expenseCategories)
      .where(eq(expenseCategories.laundryId, laundryId))
      .orderBy(expenseCategories.name);
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list expense categories" });
  }
});

expenseCategoriesRouter.post("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const data = categorySchema.parse(req.body);
    const [category] = await db.insert(expenseCategories).values({
      laundryId,
      name: data.name,
      isDefault: false,
      isActive: data.isActive ?? true,
    }).returning();
    res.status(201).json(category);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to create expense category" });
  }
});

expenseCategoriesRouter.patch("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);
    const data = categorySchema.partial().parse(req.body);
    const [category] = await db.update(expenseCategories)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(expenseCategories.id, id), eq(expenseCategories.laundryId, laundryId)))
      .returning();
    if (!category) return res.status(404).json({ error: "Category not found" });
    res.json(category);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update expense category" });
  }
});

expenseCategoriesRouter.delete("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);

    const [category] = await db.select().from(expenseCategories)
      .where(and(eq(expenseCategories.id, id), eq(expenseCategories.laundryId, laundryId)));
    if (!category) return res.status(404).json({ error: "Category not found" });
    if (category.isDefault) return res.status(400).json({ error: "Cannot delete default categories. Disable them instead." });

    await db.delete(expenseCategories)
      .where(and(eq(expenseCategories.id, id), eq(expenseCategories.laundryId, laundryId)));
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete expense category" });
  }
});
