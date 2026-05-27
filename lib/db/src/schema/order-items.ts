import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { services } from "./services.js";

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").references(() => services.id),
  serviceType: text("service_type", { enum: ["standard", "express", "premium"] }).notNull(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
