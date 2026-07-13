import { Router } from "express";
import { db } from "@workspace/db";
import { services, orderItems } from "@workspace/db/schema";
import { eq, and, ne, sql, asc } from "drizzle-orm";
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

/** Check for duplicate name (case-insensitive) within this laundry, optionally excluding a specific id */
async function isDuplicateName(laundryId: number, name: string, excludeId?: number): Promise<boolean> {
  const all = await db.select({ id: services.id, name: services.name })
    .from(services)
    .where(eq(services.laundryId, laundryId));
  return all.some(s => {
    if (excludeId && s.id === excludeId) return false;
    return s.name.trim().toLowerCase() === name.trim().toLowerCase();
  });
}

/** Get the next displayOrder value for a new service */
async function getNextDisplayOrder(laundryId: number): Promise<number> {
  const all = await db.select({ displayOrder: services.displayOrder })
    .from(services)
    .where(eq(services.laundryId, laundryId));
  if (all.length === 0) return 1;
  return Math.max(...all.map(s => s.displayOrder ?? 0)) + 1;
}

// GET /services?filter=active|archived|all
servicesRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { category, activeOnly, filter } = req.query as Record<string, string>;

    const all = await db.select().from(services)
      .where(eq(services.laundryId, laundryId))
      .orderBy(asc(services.displayOrder), asc(services.id));

    const filtered = all.filter(s => {
      // filter param takes priority over legacy activeOnly
      if (filter === "active") return s.isActive === true;
      if (filter === "archived") return s.isActive === false;
      if (filter === "all") return true;
      // legacy: activeOnly defaults to "true"
      if (activeOnly === "false") return true;
      return s.isActive === true;
    }).filter(s => {
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

    if (await isDuplicateName(laundryId, data.name)) {
      return res.status(409).json({ error: `A service named "${data.name}" already exists. Please choose a different name.` });
    }

    const displayOrder = await getNextDisplayOrder(laundryId);
    const [service] = await db.insert(services).values({
      ...data,
      laundryId,
      displayOrder,
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
    const id = parseInt(req.params.id);
    const data = serviceUpdateSchema.parse(req.body);

    if (data.name) {
      if (await isDuplicateName(laundryId, data.name, id)) {
        return res.status(409).json({ error: `A service named "${data.name}" already exists. Please choose a different name.` });
      }
    }

    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.standardPrice !== undefined) updateData.standardPrice = data.standardPrice.toString();
    if (data.expressPrice !== undefined) updateData.expressPrice = data.expressPrice.toString();
    if (data.premiumPrice !== undefined) updateData.premiumPrice = data.premiumPrice.toString();

    const [service] = await db.update(services).set(updateData)
      .where(and(eq(services.id, id), eq(services.laundryId, laundryId)))
      .returning();
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update service" });
  }
});

// POST /services/:id/archive — soft-delete: mark isActive = false
servicesRouter.post("/:id/archive", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const [service] = await db.update(services)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.laundryId, laundryId)))
      .returning();
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: "Failed to archive service" });
  }
});

// POST /services/:id/restore — restore archived service
servicesRouter.post("/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const [service] = await db.update(services)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.laundryId, laundryId)))
      .returning();
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: "Failed to restore service" });
  }
});

// POST /services/reorder — move a service up or down
servicesRouter.post("/reorder", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { id, direction } = z.object({
      id: z.number().int(),
      direction: z.enum(["up", "down"]),
    }).parse(req.body);

    const all = await db.select().from(services)
      .where(eq(services.laundryId, laundryId))
      .orderBy(asc(services.displayOrder), asc(services.id));

    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: "Service not found" });

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= all.length) {
      return res.json(all); // already at boundary, no-op
    }

    const current = all[idx];
    const swap = all[swapIdx];

    // Swap displayOrder values
    await db.update(services).set({ displayOrder: swap.displayOrder, updatedAt: new Date() })
      .where(eq(services.id, current.id));
    await db.update(services).set({ displayOrder: current.displayOrder, updatedAt: new Date() })
      .where(eq(services.id, swap.id));

    const updated = await db.select().from(services)
      .where(eq(services.laundryId, laundryId))
      .orderBy(asc(services.displayOrder), asc(services.id));
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to reorder services" });
  }
});

servicesRouter.delete("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);

    // Verify service exists and belongs to this laundry
    const [existing] = await db.select().from(services)
      .where(and(eq(services.id, id), eq(services.laundryId, laundryId)));
    if (!existing) return res.status(404).json({ error: "Service not found" });

    // Check if used by any historical orders
    const usages = await db.select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.serviceId, id))
      .limit(1);

    if (usages.length > 0) {
      return res.status(409).json({
        error: "This service cannot be deleted because it has been used in past orders. Archive it instead to hide it from new orders while keeping your historical records intact.",
        code: "SERVICE_IN_USE",
      });
    }

    await db.delete(services).where(eq(services.id, id));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete service" });
  }
});
