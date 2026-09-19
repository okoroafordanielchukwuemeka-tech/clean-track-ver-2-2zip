import { pgTable, serial, integer, text, timestamp, AnyPgColumn } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const branches = pgTable("branches", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  type: text("type", { enum: ["PROCESSING", "PICKUP", "HYBRID"] }).notNull().default("HYBRID"),
  processingDestinationBranchId: integer("processing_destination_branch_id").references((): AnyPgColumn => branches.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id"),
  deletedByType: text("deleted_by_type"),
  deletedByName: text("deleted_by_name"),
});

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;

export type BranchType = "PROCESSING" | "PICKUP" | "HYBRID";
