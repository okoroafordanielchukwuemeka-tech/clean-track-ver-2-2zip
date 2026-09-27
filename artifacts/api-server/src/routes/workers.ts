import { Router } from "express";
import { db } from "@workspace/db";
import { workers, workerPermissions, workerBranchAccess, branches, ADMIN_DEFAULT_PERMISSIONS, WORKER_DEFAULT_PERMISSIONS } from "@workspace/db/schema";
import { eq, desc, and, isNull, isNotNull, inArray } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { workerPermissionsRouter } from "./worker-permissions.js";
import { requireOperational, requirePlanLimit } from "../middleware/subscription.js";
import { logAction } from "../lib/audit.js";
import { trackActivationEvent } from "../lib/activation-tracker.js";
import { getWorkerAllowedBranchIds } from "../lib/worker-branch-access.js";

export const workersRouter = Router();

workersRouter.use("/:workerId/permissions", workerPermissionsRouter);

const workerInputSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1, "Phone number required for worker login"),
  role: z.enum(["admin", "worker"]).default("worker"),
  pin: z.string().min(4, "PIN must be at least 4 digits"),
  isActive: z.boolean().default(true),
  branchId: z.number().int().nullable().optional(),
  additionalBranchIds: z.array(z.number().int()).default([]),
});

const workerUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: z.enum(["admin", "worker"]).optional(),
  pin: z.string().min(4).optional(),
  isActive: z.boolean().optional(),
  branchId: z.number().int().nullable().optional(),
  additionalBranchIds: z.array(z.number().int()).optional(),
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
      .where(and(eq(workers.laundryId, laundryId), isNull(workers.deletedAt)))
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
      .where(and(eq(workers.id, id), eq(workers.laundryId, laundryId), isNull(workers.deletedAt)));
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    const additionalBranchIds = await getWorkerAllowedBranchIds(worker.id, laundryId);
    res.json({ ...worker, additionalBranchIds: additionalBranchIds.filter(branchId => branchId !== worker.branchId) });
  } catch {
    res.status(500).json({ error: "Failed to get worker" });
  }
});

workersRouter.post("/", requireOwner, requireOperational, requirePlanLimit("workers"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = workerInputSchema.parse(req.body);
    const requestedBranchIds = Array.from(new Set(data.additionalBranchIds));
    if (data.branchId != null) requestedBranchIds.push(data.branchId);

    if (requestedBranchIds.length > 0) {
      const ownedBranches = await db.select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.laundryId, laundryId), inArray(branches.id, requestedBranchIds)));
      if (ownedBranches.length !== new Set(requestedBranchIds).size) {
        return res.status(400).json({ error: "One or more selected branches do not belong to this laundry" });
      }
    }
    const additionalBranchIds = Array.from(new Set(data.additionalBranchIds.filter(id => id !== data.branchId)));
    const pinHash = await bcrypt.hash(data.pin, 12);
    const pinChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);

    const { worker, access } = await db.transaction(async (tx) => {
      const [createdWorker] = await tx.insert(workers).values({
        name: data.name,
        phone: data.phone,
        role: data.role,
        pin: pinHash,
        pinChangedAt,
        isActive: data.isActive,
        branchId: data.branchId ?? null,
        laundryId,
      }).returning();

      const defaults = data.role === "admin" ? ADMIN_DEFAULT_PERMISSIONS : WORKER_DEFAULT_PERMISSIONS;
      await tx.insert(workerPermissions).values({ workerId: createdWorker.id, laundryId, ...defaults });

      if (additionalBranchIds.length > 0) {
        await tx.insert(workerBranchAccess).values(
          additionalBranchIds.map(branchId => ({ workerId: createdWorker.id, branchId }))
        );
      }
      return { worker: createdWorker, access: additionalBranchIds };
    });

    const { pin: _pin, ...safeWorker } = worker;
    trackActivationEvent(laundryId, "worker_created");
    res.status(201).json({ ...safeWorker, additionalBranchIds: access });
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
    const existingAccess = await db.select({ branchId: workerBranchAccess.branchId })
      .from(workerBranchAccess)
      .where(eq(workerBranchAccess.workerId, id));
    const existingIds = existingAccess.map(row => row.branchId);
    const desiredIds = data.additionalBranchIds ?? existingIds;
    const uniqueDesiredIds = Array.from(new Set(desiredIds));
    const validationIds = Array.from(new Set([
      ...uniqueDesiredIds,
      ...(data.branchId != null ? [data.branchId] : []),
    ]));

    if (validationIds.length > 0) {
      const ownedBranches = await db.select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.laundryId, laundryId), inArray(branches.id, validationIds)));
      if (ownedBranches.length !== new Set(validationIds).size) {
        return res.status(400).json({ error: "One or more selected branches do not belong to this laundry" });
      }
    }

    const additionalBranchIds = uniqueDesiredIds.filter(branchId => branchId !== (data.branchId ?? undefined));
    const updatePayload: any = { ...data };
    delete updatePayload.additionalBranchIds;
    if (data.pin) {
      updatePayload.pin = await bcrypt.hash(data.pin, 12);
      updatePayload.pinChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
      updatePayload.failedPinAttempts = 0;
      updatePayload.pinLockedUntil = null;
    }

    const worker = await db.transaction(async (tx) => {
      const [updated] = await tx.update(workers)
        .set({ ...updatePayload, updatedAt: new Date() })
        .where(and(eq(workers.id, id), eq(workers.laundryId, laundryId), isNull(workers.deletedAt)))
        .returning();
      if (!updated) return null;

      if (data.additionalBranchIds !== undefined) {
        await tx.delete(workerBranchAccess).where(eq(workerBranchAccess.workerId, id));
        if (additionalBranchIds.length > 0) {
          await tx.insert(workerBranchAccess).values(
            additionalBranchIds.map(branchId => ({ workerId: id, branchId }))
          );
        }
      }
      return updated;
    });

    if (!worker) return res.status(404).json({ error: "Worker not found" });
    const { pin: _pin, ...safeWorker } = worker;
    res.json({ ...safeWorker, additionalBranchIds });
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

    const [existing] = await db.select().from(workers)
      .where(and(eq(workers.id, id), eq(workers.laundryId, laundryId), isNull(workers.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Worker not found" });

    const auth = req.auth!;
    const now = new Date();
    await db.update(workers).set({
      isActive: false,
      deletedAt: now,
      deletedById: auth.type === "owner" ? (auth.ownerId ?? null) : (auth.workerId ?? null),
      deletedByType: auth.type,
      deletedByName: auth.name ?? auth.email ?? "unknown",
      updatedAt: now,
    }).where(eq(workers.id, id));

    logAction({
      auth,
      laundryId,
      action: "worker_deleted",
      metadata: { workerId: id, workerName: existing.name, phone: existing.phone, role: existing.role },
    }).catch(() => {});

    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete worker" });
  }
});

workersRouter.post("/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid worker ID" });

    const [existing] = await db.select().from(workers)
      .where(and(eq(workers.id, id), eq(workers.laundryId, laundryId), isNotNull(workers.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Deleted worker not found" });

    const [restored] = await db.update(workers).set({
      isActive: true,
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
      updatedAt: new Date(),
    }).where(eq(workers.id, id)).returning();

    logAction({
      auth: req.auth!,
      laundryId,
      action: "worker_restored",
      metadata: { workerId: id, workerName: existing.name },
    }).catch(() => {});

    const { pin: _pin, ...safeWorker } = restored;
    res.json(safeWorker);
  } catch {
    res.status(500).json({ error: "Failed to restore worker" });
  }
});
