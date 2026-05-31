import { Router } from "express";
import { db } from "@workspace/db";
import { workers, workerPermissions, ADMIN_DEFAULT_PERMISSIONS, WORKER_DEFAULT_PERMISSIONS } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { workerPermissionsRouter } from "./worker-permissions.js";

export const workersRouter = Router();

workersRouter.use("/:workerId/permissions", workerPermissionsRouter);

const workerInputSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1, "Phone number required for worker login"),
  role: z.enum(["admin", "worker"]).default("worker"),
  pin: z.string().min(4, "PIN must be at least 4 digits"),
  isActive: z.boolean().default(true),
  branchId: z.number().int().nullable().optional(),
});

const workerUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: z.enum(["admin", "worker"]).optional(),
  pin: z.string().min(4).optional(),
  isActive: z.boolean().optional(),
  branchId: z.number().int().nullable().optional(),
});

workersRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select({
      id: workers.id,
      laundryId: workers.laundryId,
      branchId: workers.branchId,
      name: workers.name,
      phone: workers.phone,
      role: workers.role,
      isActive: workers.isActive,
      createdAt: workers.createdAt,
      updatedAt: workers.updatedAt,
    }).from(workers)
      .where(eq(workers.laundryId, laundryId))
      .orderBy(desc(workers.createdAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list workers" });
  }
});

workersRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid worker ID" });
    const [worker] = await db.select({
      id: workers.id,
      laundryId: workers.laundryId,
      branchId: workers.branchId,
      name: workers.name,
      phone: workers.phone,
      role: workers.role,
      isActive: workers.isActive,
      createdAt: workers.createdAt,
      updatedAt: workers.updatedAt,
    }).from(workers)
      .where(and(eq(workers.id, id), eq(workers.laundryId, laundryId)));
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    res.json(worker);
  } catch {
    res.status(500).json({ error: "Failed to get worker" });
  }
});

workersRouter.post("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = workerInputSchema.parse(req.body);
    const pinHash = await bcrypt.hash(data.pin, 12);
    const [worker] = await db.insert(workers).values({ ...data, pin: pinHash, laundryId }).returning();

    const defaults = data.role === "admin" ? ADMIN_DEFAULT_PERMISSIONS : WORKER_DEFAULT_PERMISSIONS;
    await db.insert(workerPermissions).values({ workerId: worker.id, laundryId, ...defaults });

    const { pin: _pin, ...safeWorker } = worker;
    res.status(201).json(safeWorker);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to create worker" });
  }
});

workersRouter.patch("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid worker ID" });
    const data = workerUpdateSchema.parse(req.body);
    const updatePayload: typeof data & { pin?: string } = { ...data };
    if (data.pin) {
      updatePayload.pin = await bcrypt.hash(data.pin, 12);
    }
    const [worker] = await db.update(workers)
      .set({ ...updatePayload, updatedAt: new Date() })
      .where(and(eq(workers.id, id), eq(workers.laundryId, laundryId)))
      .returning();
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    const { pin: _pin, ...safeWorker } = worker;
    res.json(safeWorker);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update worker" });
  }
});

workersRouter.delete("/:id", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid worker ID" });
    const [deleted] = await db.delete(workers)
      .where(and(eq(workers.id, id), eq(workers.laundryId, laundryId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Worker not found" });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete worker" });
  }
});
