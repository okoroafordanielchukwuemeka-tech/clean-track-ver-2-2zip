import { pgTable, serial, integer, numeric, text, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { workers } from "./workers.js";
import { laundries } from "./laundries.js";
import { branches } from "./branches.js";

// Payment provider — "manual" covers cash/transfer/pos recorded by staff today.
// The rest are reserved for future automated reconciliation (Phase 7.9 groundwork);
// their send/verify logic is not implemented yet — see lib/providers/payment-providers.ts.
export const PAYMENT_PROVIDERS = ["manual", "paystack", "flutterwave", "moniepoint"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const RECONCILIATION_STATUSES = ["confirmed", "pending", "auto_reconciled", "flagged", "failed"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const paymentRecords = pgTable("payment_records", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branches.id, { onDelete: "set null" }),
  receiptNumber: text("receipt_number").unique(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  method: text("method", { enum: ["cash", "transfer", "pos"] }).notNull().default("cash"),
  notes: text("notes"),
  remainingBalance: numeric("remaining_balance", { precision: 10, scale: 2 }).notNull(),
  recordedBy: text("recorded_by"),
  workerId: integer("worker_id").references(() => workers.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id"),
  deletedByType: text("deleted_by_type"),
  deletedByName: text("deleted_by_name"),
  deletionReason: text("deletion_reason"),

  // ── Payment reference & reconciliation (Phase 7.9) ─────────────────────
  // Defaults to the order number if not supplied — always a stable, human
  // lookup key regardless of the underlying provider.
  reference: text("reference"),
  attachmentUrl: text("attachment_url"),

  // ── Future-provider architecture (manual today; providers stubbed) ────
  provider: text("provider", { enum: PAYMENT_PROVIDERS }).notNull().default("manual"),
  providerTransactionId: text("provider_transaction_id"),
  providerReference: text("provider_reference"),
  reconciliationStatus: text("reconciliation_status", { enum: RECONCILIATION_STATUSES }).notNull().default("confirmed"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),

  // ── Duplicate-detection confidence scoring ──────────────────────────────
  confidenceScore: text("confidence_score", { enum: CONFIDENCE_LEVELS }),
  confidenceReasons: jsonb("confidence_reasons").$type<string[]>().default([]),

  // ── Refund fields (schema only — no refund workflow yet) ───────────────
  refundAmount: numeric("refund_amount", { precision: 10, scale: 2 }),
  refundReason: text("refund_reason"),
  refundReference: text("refund_reference"),
  refundedAt: timestamp("refunded_at"),
}, (t) => [
  index("payment_records_order_id_idx").on(t.orderId),
  index("payment_records_laundry_id_idx").on(t.laundryId),
  index("payment_records_recorded_at_idx").on(t.recordedAt),
  index("payment_records_deleted_at_idx").on(t.deletedAt),
  index("payment_records_reference_idx").on(t.reference),
]);

export type PaymentRecord = typeof paymentRecords.$inferSelect;
export type NewPaymentRecord = typeof paymentRecords.$inferInsert;
