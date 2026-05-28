import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const batches = pgTable("batches", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  batchCode: text("batch_code").notNull().unique(),
  status: text("status", { enum: ["active", "completed"] }).notNull().default("active"),
  orderCount: integer("order_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Batch = typeof batches.$inferSelect;
export type NewBatch = typeof batches.$inferInsert;
