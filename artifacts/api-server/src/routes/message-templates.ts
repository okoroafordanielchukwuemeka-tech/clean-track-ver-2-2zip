import { Router } from "express";
import { db } from "@workspace/db";
import { messageTemplates } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";

export const messageTemplatesRouter = Router();

const templateSchema = z.object({
  name: z.string().min(1, "Template name required"),
  subject: z.string().optional(),
  body: z.string().min(1, "Template body required"),
  isActive: z.boolean().default(true),
});

messageTemplatesRouter.get("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const result = await db.select().from(messageTemplates)
      .where(eq(messageTemplates.laundryId, laundryId))
      .orderBy(messageTemplates.name);
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list message templates" });
  }
});

messageTemplatesRouter.post("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const data = templateSchema.parse(req.body);
    const [template] = await db.insert(messageTemplates).values({
      laundryId,
      ...data,
    }).returning();
    res.status(201).json(template);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to create message template" });
  }
});

messageTemplatesRouter.patch("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);
    const data = templateSchema.partial().parse(req.body);
    const [template] = await db.update(messageTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(messageTemplates.id, id), eq(messageTemplates.laundryId, laundryId)))
      .returning();
    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update message template" });
  }
});

messageTemplatesRouter.delete("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);

    const [template] = await db.select().from(messageTemplates)
      .where(and(eq(messageTemplates.id, id), eq(messageTemplates.laundryId, laundryId)));
    if (!template) return res.status(404).json({ error: "Template not found" });
    if (template.isDefault) return res.status(400).json({ error: "Cannot delete default templates" });

    await db.delete(messageTemplates)
      .where(and(eq(messageTemplates.id, id), eq(messageTemplates.laundryId, laundryId)));
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete message template" });
  }
});
