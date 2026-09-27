import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { branches, workerBranchAccess, workers } from "@workspace/db/schema";

export class WorkerBranchAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerBranchAccessError";
  }
}

/**
 * Resolves a worker's effective branch scope from live database state.
 *
 * The worker's primary/home branch is always included. Additional branch
 * access is read from worker_branch_access on every call, so grants/revokes
 * take effect without a new login or a new JWT.
 *
 * The primary branch is not stored in worker_branch_access by this helper.
 */
export async function getWorkerAllowedBranchIds(
  workerId: number,
  laundryId: number,
): Promise<number[]> {
  const [worker] = await db
    .select({ branchId: workers.branchId })
    .from(workers)
    .where(and(eq(workers.id, workerId), eq(workers.laundryId, laundryId)));

  if (!worker) return [];

  const rows = await db
    .select({ branchId: workerBranchAccess.branchId })
    .from(workerBranchAccess)
    .innerJoin(branches, eq(branches.id, workerBranchAccess.branchId))
    .where(
      and(
        eq(workerBranchAccess.workerId, workerId),
        eq(branches.laundryId, laundryId),
      ),
    );

  return Array.from(
    new Set([
      ...(worker.branchId == null ? [] : [worker.branchId]),
      ...rows.map((row) => row.branchId),
    ]),
  );
}

export async function workerCanAccessBranch(
  workerId: number,
  laundryId: number,
  branchId: number,
): Promise<boolean> {
  const allowedBranchIds = await getWorkerAllowedBranchIds(workerId, laundryId);
  return allowedBranchIds.includes(branchId);
}

/**
 * Grants additional branch access after verifying that both the worker and
 * target branch belong to the authenticated owner's laundry.
 *
 * Granting a worker's primary branch is treated as a no-op: primary access
 * comes from workers.branchId and is never duplicated in the access table.
 */
export async function grantWorkerBranchAccess(
  workerId: number,
  laundryId: number,
  branchId: number,
): Promise<boolean> {
  const [scope] = await db
    .select({
      workerId: workers.id,
      primaryBranchId: workers.branchId,
      branchId: branches.id,
    })
    .from(workers)
    .innerJoin(branches, eq(branches.laundryId, workers.laundryId))
    .where(
      and(
        eq(workers.id, workerId),
        eq(workers.laundryId, laundryId),
        eq(branches.id, branchId),
        eq(branches.laundryId, laundryId),
      ),
    );

  if (!scope) {
    throw new WorkerBranchAccessError(
      "Worker and target branch must belong to the same laundry.",
    );
  }

  if (scope.primaryBranchId === branchId) {
    return false;
  }

  const inserted = await db
    .insert(workerBranchAccess)
    .values({ workerId, branchId })
    .onConflictDoNothing({
      target: [workerBranchAccess.workerId, workerBranchAccess.branchId],
    })
    .returning({ id: workerBranchAccess.id });

  return inserted.length > 0;
}

/**
 * Revokes additional branch access after verifying tenant ownership.
 * The worker's primary branch cannot be revoked through this function because
 * it is not represented by an access-table row.
 */
export async function revokeWorkerBranchAccess(
  workerId: number,
  laundryId: number,
  branchId: number,
): Promise<boolean> {
  const [scope] = await db
    .select({
      workerId: workers.id,
      primaryBranchId: workers.branchId,
      branchId: branches.id,
    })
    .from(workers)
    .innerJoin(branches, eq(branches.laundryId, workers.laundryId))
    .where(
      and(
        eq(workers.id, workerId),
        eq(workers.laundryId, laundryId),
        eq(branches.id, branchId),
        eq(branches.laundryId, laundryId),
      ),
    );

  if (!scope) {
    throw new WorkerBranchAccessError(
      "Worker and target branch must belong to the same laundry.",
    );
  }

  if (scope.primaryBranchId === branchId) {
    return false;
  }

  const deleted = await db
    .delete(workerBranchAccess)
    .where(
      and(
        eq(workerBranchAccess.workerId, workerId),
        eq(workerBranchAccess.branchId, branchId),
      ),
    )
    .returning({ id: workerBranchAccess.id });

  return deleted.length > 0;
}
