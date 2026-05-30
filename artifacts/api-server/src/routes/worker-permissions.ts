import { Router } from "express";
import { db } from "@workspace/db";
import { workerPermissions, workers, ADMIN_DEFAULT_PERMISSIONS, WORKER_DEFAULT_PERMISSIONS } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";

export const workerPermissionsRouter = Router({ mergeParams: true });

const permissionsSchema = z.object({
  canViewCustomers: z.boolean(),
  canCreateCustomers: z.boolean(),
  canViewCustomerBalances: z.boolean(),
  canRecordPayments: z.boolean(),
  canRecordPickups: z.boolean(),
  canViewOrders: z.boolean(),
  canProcessOrders: z.boolean(),
  canAssignOrders: z.boolean(),
});

workerPermissionsRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerId = parseInt(req.params.workerId);

    const [worker] = await db.select().from(workers)
      .where(and(eq(workers.id, workerId), eq(workers.laundryId, laundryId)));
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    const [perms] = await db.select().from(workerPermissions)
      .where(eq(workerPermissions.workerId, workerId));

    if (!perms) {
      const defaults = worker.role === "admin" ? ADMIN_DEFAULT_PERMISSIONS : WORKER_DEFAULT_PERMISSIONS;
      const [created] = await db.insert(workerPermissions).values({
        workerId,
        laundryId,
        ...defaults,
      }).returning();
      return res.json(created);
    }

    res.json(perms);
  } catch {
    res.status(500).json({ error: "Failed to get worker permissions" });
  }
});

workerPermissionsRouter.put("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerId = parseInt(req.params.workerId);

    const [worker] = await db.select().from(workers)
      .where(and(eq(workers.id, workerId), eq(workers.laundryId, laundryId)));
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    const data = permissionsSchema.parse(req.body);

    const [existing] = await db.select().from(workerPermissions)
      .where(eq(workerPermissions.workerId, workerId));

    let result;
    if (existing) {
      const [updated] = await db.update(workerPermissions)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(workerPermissions.workerId, workerId))
        .returning();
      result = updated;
    } else {
      const [created] = await db.insert(workerPermissions).values({
        workerId,
        laundryId,
        ...data,
      }).returning();
      result = created;
    }

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update worker permissions" });
  }
});
