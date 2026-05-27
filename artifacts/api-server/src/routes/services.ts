import { Router } from "express";
import { db } from "@workspace/db";
import { services } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

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

servicesRouter.get("/", async (req, res) => {
  try {
    const { category, activeOnly = "true" } = req.query;
    let query = db.select().from(services);
    const conditions = [];
    if (activeOnly === "true") conditions.push(eq(services.isActive, true));
    if (category) conditions.push(eq(services.category, category as string));

    const result = await db.select().from(services);
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

servicesRouter.get("/:id", async (req, res) => {
  try {
    const [service] = await db.select().from(services).where(eq(services.id, parseInt(req.params.id)));
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: "Failed to get service" });
  }
});

servicesRouter.post("/", async (req, res) => {
  try {
    const data = serviceInputSchema.parse(req.body);
    const [service] = await db.insert(services).values({
      ...data,
      standardPrice: data.standardPrice.toString(),
      expressPrice: data.expressPrice?.toString(),
      premiumPrice: data.premiumPrice?.toString(),
    }).returning();
    res.status(201).json(service);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to create service" });
  }
});

servicesRouter.patch("/:id", async (req, res) => {
  try {
    const data = serviceUpdateSchema.parse(req.body);
    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.standardPrice !== undefined) updateData.standardPrice = data.standardPrice.toString();
    if (data.expressPrice !== undefined) updateData.expressPrice = data.expressPrice.toString();
    if (data.premiumPrice !== undefined) updateData.premiumPrice = data.premiumPrice.toString();

    const [service] = await db.update(services).set(updateData)
      .where(eq(services.id, parseInt(req.params.id))).returning();
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update service" });
  }
});

servicesRouter.delete("/:id", async (req, res) => {
  try {
    const [deleted] = await db.delete(services).where(eq(services.id, parseInt(req.params.id))).returning();
    if (!deleted) return res.status(404).json({ error: "Service not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete service" });
  }
});
