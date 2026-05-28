import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const workers = pgTable("workers", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  role: text("role", { enum: ["admin", "worker"] }).notNull().default("worker"),
  pin: text("pin"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Worker = typeof workers.$inferSelect;
export type NewWorker = typeof workers.$inferInsert;
