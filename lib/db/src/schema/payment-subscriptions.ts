/**
 * Payment Subscriptions — recurring-billing state per tenant (Phase 7.8).
 *
 * CleanTrack bills recurring subscriptions by re-charging a saved Paystack
 * card *authorization* (see docs/billing-architecture.md for why this was
 * chosen over Paystack's native Plan/Subscription objects). One row per
 * laundry holds the reusable authorization and renewal bookkeeping.
 */
import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const PAYMENT_SUBSCRIPTION_STATUSES = [
  "active",
  "attention", // last charge failed, still within grace/dunning
  "non_renewing", // cancelled but not yet expired
  "cancelled",
] as const;
export type PaymentSubscriptionStatus = (typeof PAYMENT_SUBSCRIPTION_STATUSES)[number];

export const paymentSubscriptions = pgTable(
  "payment_subscriptions",
  {
    id: serial("id").primaryKey(),

    laundryId: integer("laundry_id")
      .notNull()
      .unique()
      .references(() => laundries.id, { onDelete: "cascade" }),

    provider: text("provider").notNull().default("paystack"),

    /** Paystack customer_code, e.g. "CUS_xxx" */
    customerCode: text("customer_code"),

    /** Reusable card authorization returned from a successful charge */
    authorizationCode: text("authorization_code"),
    cardLast4: text("card_last4"),
    cardBank: text("card_bank"),
    cardType: text("card_type"),
    reusable: boolean("reusable").notNull().default(false),

    plan: text("plan").notNull(),
    billingPeriod: text("billing_period").notNull().default("monthly"),
    amountNgn: integer("amount_ngn").notNull(),

    status: text("status", { enum: PAYMENT_SUBSCRIPTION_STATUSES }).notNull().default("active"),

    /** Next date the renewal scheduler should attempt an auto-charge */
    nextChargeAt: timestamp("next_charge_at"),

    /** Consecutive failed renewal attempts since the last success */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastChargeAt: timestamp("last_charge_at"),
    lastChargeStatus: text("last_charge_status"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("payment_subscriptions_status_idx").on(t.status),
    index("payment_subscriptions_next_charge_idx").on(t.nextChargeAt),
  ]
);

export type PaymentSubscription = typeof paymentSubscriptions.$inferSelect;
export type NewPaymentSubscription = typeof paymentSubscriptions.$inferInsert;
