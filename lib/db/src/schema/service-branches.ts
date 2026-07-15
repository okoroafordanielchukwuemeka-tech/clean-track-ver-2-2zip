import { pgTable, serial, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { services } from "./services.js";
import { branches } from "./branches.js";

/**
 * Phase 7.10 — branch availability for services.
 *
 * A service with NO rows here is available at every branch (backward
 * compatible default for laundries that never configured branch-specific
 * catalogs). A service with one or more rows is available ONLY at the
 * listed branches.
 */
export const serviceBranches = pgTable("service_branches", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueServiceBranch: unique().on(t.serviceId, t.branchId),
  serviceIdIdx: index("service_branches_service_id_idx").on(t.serviceId),
  branchIdIdx: index("service_branches_branch_id_idx").on(t.branchId),
}));

export type ServiceBranch = typeof serviceBranches.$inferSelect;
export type NewServiceBranch = typeof serviceBranches.$inferInsert;
