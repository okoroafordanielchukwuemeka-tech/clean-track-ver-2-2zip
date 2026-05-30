import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { workers } from "./workers.js";
import { laundries } from "./laundries.js";

export const paymentRecords = pgTable("payment_records", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  receiptNumber: text("receipt_number").unique(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  method: text("method", { enum: ["cash", "transfer", "pos"] }).notNull().default("cash"),
  notes: text("notes"),
  remainingBalance: numeric("remaining_balance", { precision: 10, scale: 2 }).notNull(),
  recordedBy: text("recorded_by"),
  workerId: integer("worker_id").references(() => workers.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

export type PaymentRecord = typeof paymentRecords.$inferSelect;
export type NewPaymentRecord = typeof paymentRecords.$inferInsert;
