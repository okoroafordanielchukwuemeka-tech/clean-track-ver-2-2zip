import { pgTable, serial, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { batches } from "./batches.js";
import { workers } from "./workers.js";

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  address: text("address"),
  serviceType: text("service_type", { enum: ["standard", "express", "premium"] }).notNull().default("standard"),
  shirts: integer("shirts").notNull().default(0),
  trousers: integer("trousers").notNull().default(0),
  additionalNotes: text("additional_notes"),
  status: text("status", { enum: ["pending", "processing", "ready"] }).notNull().default("pending"),
  paymentStatus: text("payment_status", { enum: ["unpaid", "partial", "paid"] }).notNull().default("unpaid"),
  price: numeric("price", { precision: 10, scale: 2 }),
  extraCharge: numeric("extra_charge", { precision: 10, scale: 2 }),
  discount: numeric("discount", { precision: 10, scale: 2 }),
  amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  verifiedShirts: integer("verified_shirts"),
  verifiedTrousers: integer("verified_trousers"),
  isVerified: boolean("is_verified").notNull().default(false),
  batchId: integer("batch_id").references(() => batches.id),
  assignedWorkerId: integer("assigned_worker_id").references(() => workers.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
