import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { laundries } from "./laundries.js";

export const priceAdjustments = pgTable("price_adjustments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["discount", "extra_charge"] }).notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  appliedBy: text("applied_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PriceAdjustment = typeof priceAdjustments.$inferSelect;
export type NewPriceAdjustment = typeof priceAdjustments.$inferInsert;
