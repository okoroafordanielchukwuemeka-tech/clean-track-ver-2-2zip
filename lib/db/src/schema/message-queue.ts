import {
  pgTable, serial, integer, text, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { notificationEvents } from "./notification-events.js";

export const MESSAGE_QUEUE_STATUSES = [
  "pending",
  "sending",
  "sent",
  "retry",
  "failed",
] as const;
export type MessageQueueStatus = (typeof MESSAGE_QUEUE_STATUSES)[number];

export const messageQueue = pgTable(
  "message_queue",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    templateName: text("template_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    recipientName: text("recipient_name"),
    variables: jsonb("variables").$type<Record<string, string>>().notNull().default({}),
    renderedBody: text("rendered_body").notNull(),
    channel: text("channel").notNull().default("whatsapp"),
    status: text("status", { enum: MESSAGE_QUEUE_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastAttemptAt: timestamp("last_attempt_at"),
    nextRetryAt: timestamp("next_retry_at"),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    notificationEventId: integer("notification_event_id").references(
      () => notificationEvents.id,
      { onDelete: "set null" }
    ),
    notificationMessageId: integer("notification_message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("msg_queue_laundry_idx").on(t.laundryId),
    index("msg_queue_status_idx").on(t.status),
    index("msg_queue_next_retry_idx").on(t.nextRetryAt),
    index("msg_queue_laundry_status_idx").on(t.laundryId, t.status),
    index("msg_queue_created_at_idx").on(t.createdAt),
  ]
);

export type MessageQueueEntry = typeof messageQueue.$inferSelect;
export type NewMessageQueueEntry = typeof messageQueue.$inferInsert;
