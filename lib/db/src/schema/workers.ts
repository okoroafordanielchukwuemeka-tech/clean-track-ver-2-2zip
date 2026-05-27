import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const workers = pgTable("workers", {
  id: serial("id").primaryKey(),
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
