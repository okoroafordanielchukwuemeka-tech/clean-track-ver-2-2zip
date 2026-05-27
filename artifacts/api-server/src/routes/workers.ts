import { Router } from "express";
import { db } from "@workspace/db";
import { workers, orders } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

export const workersRouter = Router();

const workerInputSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(["admin", "worker"]).default("worker"),
  pin: z.string().optional(),
  isActive: z.boolean().default(true),
});

const workerUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: z.enum(["admin", "worker"]).optional(),
  pin: z.string().optional(),
  isActive: z.boolean().optional(),
});

workersRouter.get("/", async (_req, res) => {
  try {
    const result = await db.select().from(workers).orderBy(desc(workers.createdAt));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to list workers" });
  }
});

workersRouter.get("/:id", async (req, res) => {
  try {
    const [worker] = await db.select().from(workers).where(eq(workers.id, parseInt(req.params.id)));
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    res.json(worker);
  } catch (err) {
    res.status(500).json({ error: "Failed to get worker" });
  }
});

workersRouter.post("/", async (req, res) => {
  try {
    const data = workerInputSchema.parse(req.body);
    const [worker] = await db.insert(workers).values(data).returning();
    res.status(201).json(worker);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to create worker" });
  }
});

workersRouter.patch("/:id", async (req, res) => {
  try {
    const data = workerUpdateSchema.parse(req.body);
    const [worker] = await db.update(workers).set({ ...data, updatedAt: new Date() })
      .where(eq(workers.id, parseInt(req.params.id))).returning();
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    res.json(worker);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update worker" });
  }
});

workersRouter.delete("/:id", async (req, res) => {
  try {
    const [deleted] = await db.delete(workers).where(eq(workers.id, parseInt(req.params.id))).returning();
    if (!deleted) return res.status(404).json({ error: "Worker not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete worker" });
  }
});

workersRouter.post("/login", async (req, res) => {
  try {
    const { pin } = z.object({ pin: z.string() }).parse(req.body);
    const allWorkers = await db.select().from(workers);
    const worker = allWorkers.find(w => w.pin === pin && w.isActive);
    if (!worker) return res.status(401).json({ error: "Invalid PIN" });
    res.json({ worker, role: worker.role });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});
