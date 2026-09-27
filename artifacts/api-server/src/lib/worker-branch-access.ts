import { and, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { branches, workerBranchAccess, workers } from "@workspace/db/schema";

export async function getWorkerAllowedBranchIds(workerId: number, laundryId: number): Promise<number[]> {
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
        eq(branches.laundryId, laundryId)
      )
    );

  return Array.from(new Set([
    ...(worker.branchId == null ? [] : [worker.branchId]),
    ...rows.map(row => row.branchId),
  ]));
}

export async function workerCanAccessBranch(
  workerId: number,
  laundryId: number,
  branchId: number,
): Promise<boolean> {
  const allowed = await getWorkerAllowedBranchIds(workerId, laundryId);
  return allowed.includes(branchId);
}

export function workerBranchSql(column: SQL, branchIds: number[]): SQL {
  if (branchIds.length === 0) return sql`FALSE`;
  return sql`${column} IN (${sql.join(branchIds.map(id => sql`${id}`), sql`, `)})`;
}
