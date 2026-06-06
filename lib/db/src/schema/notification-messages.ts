import {
  pgTable, serial, integer, text, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { notificationEvents } from "./notification-events.js";
import { notificationTemplates } from "./notification-templates.js";
import { NOTIFICATION_CHANNELS } from "./notification-templates.js";

export const MESSAGE_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
};

export const notificationMessages = pgTable(
  "notification_messages",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    eventId: integer("event_id").references(() => notificationEvents.id, {
      onDelete: "set null",
    }),
    templateId: integer("template_id").references(
      () => notificationTemplates.id,
      { onDelete: "set null" }
    ),
    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    recipientName: text("recipient_name"),
    renderedBody: text("rendered_body").notNull(),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    retryCount: integer("retry_count").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    queuedAt: timestamp("queued_at").notNull().defaultNow(),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    failedAt: timestamp("failed_at"),
  },
  (t) => [
    index("notif_messages_laundry_idx").on(t.laundryId),
    index("notif_messages_event_id_idx").on(t.eventId),
    index("notif_messages_template_id_idx").on(t.templateId),
    index("notif_messages_status_idx").on(t.status),
    index("notif_messages_channel_idx").on(t.channel),
    index("notif_messages_recipient_idx").on(t.recipientPhone),
    index("notif_messages_queued_at_idx").on(t.queuedAt),
    index("notif_messages_provider_msg_id_idx").on(t.providerMessageId),
  ]
);

export type NotificationMessage = typeof notificationMessages.$inferSelect;
export type NewNotificationMessage = typeof notificationMessages.$inferInsert;
