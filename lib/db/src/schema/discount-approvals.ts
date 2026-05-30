import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { orders } from "./orders.js";
import { workers } from "./workers.js";

export const discountApprovals = pgTable("discount_approvals", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  requestedBy: integer("requested_by").references(() => workers.id, { onDelete: "set null" }),
  requestedByName: text("requested_by_name").notNull(),
  originalAmount: numeric("original_amount", { precision: 10, scale: 2 }).notNull(),
  requestedDiscount: numeric("requested_discount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DiscountApproval = typeof discountApprovals.$inferSelect;
export type NewDiscountApproval = typeof discountApprovals.$inferInsert;
