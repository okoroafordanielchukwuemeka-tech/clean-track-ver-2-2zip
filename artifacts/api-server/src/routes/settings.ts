import { Router } from "express";
import { db } from "@workspace/db";
import { laundries } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";

export const settingsRouter = Router();

const slaSchema = z.object({
  standardTurnaroundHours: z.number().int().min(1).max(336),
  expressTurnaroundHours: z.number().int().min(1).max(336),
  premiumTurnaroundHours: z.number().int().min(1).max(336),
});

settingsRouter.get("/sla", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const [laundry] = await db
      .select({
        standardTurnaroundHours: laundries.standardTurnaroundHours,
        expressTurnaroundHours: laundries.expressTurnaroundHours,
        premiumTurnaroundHours: laundries.premiumTurnaroundHours,
      })
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    res.json(laundry);
  } catch {
    res.status(500).json({ error: "Failed to get SLA settings" });
  }
});

settingsRouter.patch("/sla", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const data = slaSchema.partial().parse(req.body);
    const [updated] = await db
      .update(laundries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(laundries.id, laundryId))
      .returning({
        standardTurnaroundHours: laundries.standardTurnaroundHours,
        expressTurnaroundHours: laundries.expressTurnaroundHours,
        premiumTurnaroundHours: laundries.premiumTurnaroundHours,
      });
    if (!updated) return res.status(404).json({ error: "Laundry not found" });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update SLA settings" });
  }
});
