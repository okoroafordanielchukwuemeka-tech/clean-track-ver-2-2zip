/**
 * Webhook Events — durable idempotency + audit log for inbound payment
 * provider webhooks (Phase 7.8 — Payment Automation & Billing Infrastructure).
 *
 * Every inbound webhook is recorded here BEFORE processing, keyed on a
 * provider-specific unique event identifier. If the same event arrives
 * twice (provider retries, network duplication), the unique constraint on
 * (provider, eventKey) causes the second insert to fail and the handler
 * treats it as "already processed" — safe, idempotent, no double side effects.
 */
import { pgTable, serial, text, integer, jsonb, timestamp, unique, index } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const WEBHOOK_EVENT_STATUSES = [
  "received",
  "processed",
  "ignored",
  "failed",
  "duplicate",
  "rejected",
] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: serial("id").primaryKey(),

    /** "paystack" (future-proof for other providers) */
    provider: text("provider").notNull(),

    /** Provider event type, e.g. "charge.success", "charge.failed" */
    eventType: text("event_type").notNull(),

    /**
     * Stable de-duplication key derived from the payload (e.g. a hash of
     * provider + transaction reference + event type). NOT the raw signature
     * (signatures can differ for retried-but-identical payloads).
     */
    eventKey: text("event_key").notNull(),

    laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "set null" }),

    /** Transaction/charge reference from the provider, if present */
    reference: text("reference"),

    status: text("status", { enum: WEBHOOK_EVENT_STATUSES }).notNull().default("received"),

    /** Full decoded JSON payload for audit/debugging */
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),

    /** Populated if status = "failed" */
    error: text("error"),

    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    unique("webhook_events_provider_key_unique").on(t.provider, t.eventKey),
    index("webhook_events_laundry_id_idx").on(t.laundryId),
    index("webhook_events_received_at_idx").on(t.receivedAt),
  ]
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
