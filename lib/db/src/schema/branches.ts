import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const branches = pgTable("branches", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id"),
  deletedByType: text("deleted_by_type"),
  deletedByName: text("deleted_by_name"),
});

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
