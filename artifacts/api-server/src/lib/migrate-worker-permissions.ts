/**
 * Worker Permissions Backfill Migration
 *
 * Runs automatically at server startup. Finds every worker that has no row
 * in worker_permissions and creates one using WORKER_DEFAULT_PERMISSIONS.
 *
 * Safe to run on every boot — the INSERT is skipped when the row exists.
 * Workers manually configured by owners are never touched.
 */

import { db } from "@workspace/db";
import { workers, workerPermissions, WORKER_DEFAULT_PERMISSIONS, ADMIN_DEFAULT_PERMISSIONS } from "@workspace/db/schema";
import { eq, notInArray, sql } from "drizzle-orm";

export async function migrateWorkerPermissions(): Promise<void> {
  try {
    // Find workers that have no worker_permissions row
    const existingPermWorkerIds = await db
      .select({ workerId: workerPermissions.workerId })
      .from(workerPermissions);

    const coveredIds = existingPermWorkerIds.map((r) => r.workerId);

    const query = coveredIds.length > 0
      ? db.select({ id: workers.id, laundryId: workers.laundryId, role: workers.role })
          .from(workers)
          .where(notInArray(workers.id, coveredIds))
      : db.select({ id: workers.id, laundryId: workers.laundryId, role: workers.role })
          .from(workers);

    const unmigratedWorkers = await query;

    if (unmigratedWorkers.length === 0) {
      console.log("[migrate-worker-permissions] All workers already have permission records.");
      return;
    }

    console.log(`[migrate-worker-permissions] Backfilling ${unmigratedWorkers.length} worker(s) with default operational permissions...`);

    for (const worker of unmigratedWorkers) {
      const defaults = worker.role === "admin" ? ADMIN_DEFAULT_PERMISSIONS : WORKER_DEFAULT_PERMISSIONS;
      await db
        .insert(workerPermissions)
        .values({
          workerId: worker.id,
          laundryId: worker.laundryId,
          ...defaults,
        })
        .onConflictDoNothing(); // safe re-run guard
    }

    console.log(`[migrate-worker-permissions] ✓ Created ${unmigratedWorkers.length} permission record(s).`);
  } catch (err) {
    // Non-fatal: log and continue — a startup failure here should not block the server
    console.error("[migrate-worker-permissions] Migration failed (non-fatal):", err);
  }
}
