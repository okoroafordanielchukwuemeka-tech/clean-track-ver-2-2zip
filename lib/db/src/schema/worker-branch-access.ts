import { pgTable, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { workers } from "./workers.js";
import { branches } from "./branches.js";

export const workerBranchAccess = pgTable("worker_branch_access", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("worker_branch_access_worker_branch_uq").on(t.workerId, t.branchId),
  index("worker_branch_access_worker_id_idx").on(t.workerId),
  index("worker_branch_access_branch_id_idx").on(t.branchId),
]);

export type WorkerBranchAccess = typeof workerBranchAccess.$inferSelect;
export type NewWorkerBranchAccess = typeof workerBranchAccess.$inferInsert;
