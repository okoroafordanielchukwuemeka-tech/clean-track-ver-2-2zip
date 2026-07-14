/**
 * Subscription Payments — manual and future-automated payment records.
 *
 * When an owner pays for a subscription (via bank transfer or Paystack/
 * Flutterwave in future), an admin records it here and activates the plan.
 * This table is the audit trail for all subscription revenue.
 */
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const SUBSCRIPTION_PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
  "refunded",
] as const;

export type SubscriptionPaymentStatus =
  (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

export const subscriptionPayments = pgTable("subscription_payments", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id")
    .notNull()
    .references(() => laundries.id, { onDelete: "cascade" }),

  /** Amount paid in NGN (kobo-safe — stored as naira, not kobo) */
  amountNgn: integer("amount_ngn").notNull(),

  /** Plan tier paid for: "starter" | "pro" | "business" */
  plan: text("plan").notNull(),

  /** e.g. "2025-07" — the month this payment covers */
  billingPeriod: text("billing_period"),

  status: text("status", { enum: SUBSCRIPTION_PAYMENT_STATUSES })
    .notNull()
    .default("pending"),

  /** "bank_transfer" | "paystack" | "flutterwave" | "manual" */
  paymentMethod: text("payment_method").notNull().default("bank_transfer"),

  /** Payment provider reference or internal reference */
  reference: text("reference"),

  /** Admin user who recorded this payment (for manual entries) */
  recordedBy: text("recorded_by"),

  notes: text("notes"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SubscriptionPayment = typeof subscriptionPayments.$inferSelect;
export type NewSubscriptionPayment = typeof subscriptionPayments.$inferInsert;
