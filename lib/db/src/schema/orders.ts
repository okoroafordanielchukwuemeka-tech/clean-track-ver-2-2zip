import { pgTable, serial, text, integer, numeric, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { batches } from "./batches.js";
import { workers } from "./workers.js";
import { laundries } from "./laundries.js";
import { customers } from "./customers.js";
import { branches } from "./branches.js";

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branches.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => customers.id, { onDelete: "set null" }),
  orderId: text("order_id").notNull().unique(),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  address: text("address"),
  serviceType: text("service_type", { enum: ["standard", "express", "premium"] }).notNull().default("standard"),
  shirts: integer("shirts").notNull().default(0),
  trousers: integer("trousers").notNull().default(0),
  shirtsPickedUp: integer("shirts_picked_up").notNull().default(0),
  trousersPickedUp: integer("trousers_picked_up").notNull().default(0),
  additionalNotes: text("additional_notes"),
  status: text("status", { enum: ["pending", "processing", "ready", "partial_pickup", "completed", "cancelled"] }).notNull().default("pending"),
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
  processingDueAt: timestamp("processing_due_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("orders_laundry_id_idx").on(t.laundryId),
  index("orders_branch_id_idx").on(t.branchId),
  index("orders_customer_id_idx").on(t.customerId),
  index("orders_status_idx").on(t.status),
  index("orders_payment_status_idx").on(t.paymentStatus),
  index("orders_created_at_idx").on(t.createdAt),
  index("orders_laundry_status_idx").on(t.laundryId, t.status),
  index("orders_laundry_branch_idx").on(t.laundryId, t.branchId),
  index("orders_processing_due_idx").on(t.processingDueAt),
]);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
