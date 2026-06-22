import { pgTable, serial, text, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { branches } from "./branches.js";

export const workers = pgTable("workers", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branches.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  phone: text("phone"),
  role: text("role", { enum: ["admin", "worker"] }).notNull().default("worker"),
  pin: text("pin"),
  isActive: boolean("is_active").notNull().default(true),
  failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id"),
  deletedByType: text("deleted_by_type"),
  deletedByName: text("deleted_by_name"),
}, (t) => [
  index("workers_laundry_id_idx").on(t.laundryId),
  index("workers_branch_id_idx").on(t.branchId),
  index("workers_phone_idx").on(t.phone),
  index("workers_deleted_at_idx").on(t.deletedAt),
]);

export type Worker = typeof workers.$inferSelect;
export type NewWorker = typeof workers.$inferInsert;
