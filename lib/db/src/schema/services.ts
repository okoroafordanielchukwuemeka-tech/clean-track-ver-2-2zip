import { pgTable, serial, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  standardPrice: numeric("standard_price", { precision: 10, scale: 2 }).notNull(),
  expressPrice: numeric("express_price", { precision: 10, scale: 2 }),
  premiumPrice: numeric("premium_price", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
