import { Router } from "express";
import { db } from "@workspace/db";
import { services } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { trackActivationEvent } from "../lib/activation-tracker.js";

export const servicesRouter = Router();

const serviceInputSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  standardPrice: z.number().min(0),
  expressPrice: z.number().optional(),
  premiumPrice: z.number().optional(),
  isActive: z.boolean().default(true),
});

const serviceUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  standardPrice: z.number().min(0).optional(),
  expressPrice: z.number().optional(),
  premiumPrice: z.number().optional(),
  isActive: z.boolean().optional(),
});

servicesRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { category, activeOnly = "true" } = req.query;
    const result = await db.select().from(services)
      .where(eq(services.laundryId, laundryId));
    const filtered = result.filter(s => {
      if (activeOnly === "true" && !s.isActive) return false;
      if (category && s.category !== category) return false;
      return true;
    });
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: "Failed to list services" });
  }
});

servicesRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [service] = await db.select().from(services)
      .where(and(eq(services.id, parseInt(req.params.id)), eq(services.laundryId, laundryId)));
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: "Failed to get service" });
  }
});

servicesRouter.post("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = serviceInputSchema.parse(req.body);
    const [service] = await db.insert(services).values({
      ...data,
      laundryId,
      standardPrice: data.standardPrice.toString(),
      expressPrice: data.expressPrice?.toString(),
      premiumPrice: data.premiumPrice?.toString(),
    }).returning();
    trackActivationEvent(laundryId, "service_created");
    res.status(201).json(service);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to create service" });
  }
});

servicesRouter.patch("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = serviceUpdateSchema.parse(req.body);
    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.standardPrice !== undefined) updateData.standardPrice = data.standardPrice.toString();
    if (data.expressPrice !== undefined) updateData.expressPrice = data.expressPrice.toString();
    if (data.premiumPrice !== undefined) updateData.premiumPrice = data.premiumPrice.toString();

    const [service] = await db.update(services).set(updateData)
      .where(and(eq(services.id, parseInt(req.params.id)), eq(services.laundryId, laundryId)))
      .returning();
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update service" });
  }
});

servicesRouter.delete("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const [deleted] = await db.delete(services)
      .where(and(eq(services.id, parseInt(req.params.id)), eq(services.laundryId, laundryId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Service not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete service" });
  }
});
