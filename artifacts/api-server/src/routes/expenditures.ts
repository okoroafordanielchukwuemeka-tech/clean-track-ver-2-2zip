import { Router } from "express";
import { db } from "@workspace/db";
import { expenditures, EXPENSE_CATEGORIES } from "@workspace/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";

export const expendituresRouter = Router();

const expenditureSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().positive("Amount must be positive"),
  notes: z.string().optional(),
  isRecurring: z.boolean().default(false),
});

function getPeriodStart(period: string): Date {
  const since = new Date();
  if (period === "today") since.setHours(0, 0, 0, 0);
  else if (period === "7d") since.setDate(since.getDate() - 7);
  else if (period === "30d") since.setDate(since.getDate() - 30);
  else if (period === "90d") since.setDate(since.getDate() - 90);
  else since.setDate(since.getDate() - 30);
  return since;
}

expendituresRouter.get("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const { period } = req.query;
    const conditions: any[] = [eq(expenditures.laundryId, laundryId)];
    if (period) conditions.push(gte(expenditures.createdAt, getPeriodStart(period as string)));

    const result = await db
      .select()
      .from(expenditures)
      .where(and(...conditions))
      .orderBy(desc(expenditures.createdAt));

    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list expenditures" });
  }
});

expendituresRouter.get("/summary", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const { period = "30d" } = req.query;
    const since = getPeriodStart(period as string);

    const items = await db
      .select()
      .from(expenditures)
      .where(and(eq(expenditures.laundryId, laundryId), gte(expenditures.createdAt, since)));

    const total = items.reduce((s, e) => s + parseFloat(e.amount), 0);
    const byCategory: Record<string, number> = {};
    for (const e of items) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + parseFloat(e.amount);
    }

    res.json({ total, byCategory, count: items.length, period });
  } catch {
    res.status(500).json({ error: "Failed to get expenditure summary" });
  }
});

expendituresRouter.post("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const data = expenditureSchema.parse(req.body);
    const [item] = await db
      .insert(expenditures)
      .values({
        laundryId,
        category: data.category,
        amount: data.amount.toString(),
        notes: data.notes,
        isRecurring: data.isRecurring,
      })
      .returning();
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to create expenditure" });
  }
});

expendituresRouter.patch("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);
    const data = expenditureSchema.partial().parse(req.body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.amount !== undefined) updateData.amount = data.amount.toString();
    if (data.category !== undefined) updateData.category = data.category;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.isRecurring !== undefined) updateData.isRecurring = data.isRecurring;

    const [item] = await db
      .update(expenditures)
      .set(updateData)
      .where(and(eq(expenditures.id, id), eq(expenditures.laundryId, laundryId)))
      .returning();

    if (!item) return res.status(404).json({ error: "Expenditure not found" });
    res.json(item);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update expenditure" });
  }
});

expendituresRouter.delete("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);
    await db
      .delete(expenditures)
      .where(and(eq(expenditures.id, id), eq(expenditures.laundryId, laundryId)));
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete expenditure" });
  }
});
