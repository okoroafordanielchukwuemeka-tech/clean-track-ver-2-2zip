import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { branches } from "./branches.js";

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branches.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull(),
  phone: text("phone").notNull(),
  address: text("address"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id"),
  deletedByType: text("deleted_by_type"),
  deletedByName: text("deleted_by_name"),
}, (t) => [
  index("customers_laundry_id_idx").on(t.laundryId),
  index("customers_branch_id_idx").on(t.branchId),
  index("customers_phone_idx").on(t.phone),
  index("customers_deleted_at_idx").on(t.deletedAt),
]);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
