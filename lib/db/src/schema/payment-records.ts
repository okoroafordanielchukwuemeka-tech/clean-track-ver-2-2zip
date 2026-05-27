import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";

export const paymentRecords = pgTable("payment_records", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  method: text("method", { enum: ["cash", "transfer", "pos"] }).notNull().default("cash"),
  notes: text("notes"),
  remainingBalance: numeric("remaining_balance", { precision: 10, scale: 2 }).notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

export type PaymentRecord = typeof paymentRecords.$inferSelect;
export type NewPaymentRecord = typeof paymentRecords.$inferInsert;
