/**
 * Invoices — permanent, customer-facing billing records (Phase 7.8).
 *
 * One invoice is generated for every billing event: new subscription,
 * renewal, upgrade, downgrade, or manual admin payment. Invoices are never
 * deleted — they remain permanently available to the customer for download.
 */
import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { subscriptionPayments } from "./subscription-payments.js";

export const INVOICE_TYPES = [
  "new_subscription",
  "renewal",
  "upgrade",
  "downgrade",
  "manual",
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_STATUSES = ["paid", "pending", "failed", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),

    /** Human-facing invoice number, e.g. "INV-2026-000123" — permanent, never reused */
    invoiceNumber: text("invoice_number").notNull().unique(),

    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),

    /** Linked payment record once paid (nullable while pending) */
    subscriptionPaymentId: integer("subscription_payment_id").references(
      () => subscriptionPayments.id,
      { onDelete: "set null" }
    ),

    type: text("type", { enum: INVOICE_TYPES }).notNull(),

    /** Snapshot fields — invoices must not change if business/plan data changes later */
    businessName: text("business_name").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    plan: text("plan").notNull(),
    planDisplayName: text("plan_display_name").notNull(),
    billingPeriod: text("billing_period"),

    subtotalNgn: integer("subtotal_ngn").notNull(),
    taxNgn: integer("tax_ngn").notNull().default(0),
    totalNgn: integer("total_ngn").notNull(),

    status: text("status", { enum: INVOICE_STATUSES }).notNull().default("pending"),

    /** "paystack" | "manual" | "bank_transfer" */
    paymentMethod: text("payment_method").notNull().default("paystack"),
    transactionReference: text("transaction_reference"),

    issueDate: timestamp("issue_date").notNull().defaultNow(),
    dueDate: timestamp("due_date").notNull(),
    paidAt: timestamp("paid_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("invoices_laundry_id_idx").on(t.laundryId),
    index("invoices_status_idx").on(t.status),
    index("invoices_issue_date_idx").on(t.issueDate),
  ]
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
