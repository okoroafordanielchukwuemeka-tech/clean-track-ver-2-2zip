/**
 * Shared Inbox Foundation — Future Architecture
 *
 * These tables are designed to support a future WhatsApp/SMS shared inbox
 * inside CleanTrack where customer replies appear alongside outbound messages.
 *
 * Relationships:
 *   laundries ──< conversations ──< conversation_messages
 *                     │
 *                     ├──< conversation_participants (workers watching)
 *                     └── assigned_worker_id (current handler)
 *
 * Retention Policy:
 *   - conversations: indefinite (searchable customer history)
 *   - conversation_messages: 12 months rolling (configurable)
 *   - conversation_participants: soft-delete via is_active flag
 *
 * Integration Points (future):
 *   - POST /api/webhooks/whatsapp  → creates inbound conversation_message
 *   - PATCH /conversations/:id/assign → sets assigned_worker_id
 *   - GET /conversations → shared inbox view (requireAuth)
 */

import {
  pgTable, serial, integer, text, boolean, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { branches } from "./branches.js";
import { customers } from "./customers.js";
import { workers } from "./workers.js";

export const CONVERSATION_CHANNELS = ["whatsapp", "sms"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONVERSATION_STATUSES = ["open", "resolved", "archived"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    branchId: integer("branch_id").references(() => branches.id, {
      onDelete: "set null",
    }),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    channel: text("channel", { enum: CONVERSATION_CHANNELS }).notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerName: text("customer_name"),
    status: text("status", { enum: CONVERSATION_STATUSES })
      .notNull()
      .default("open"),
    assignedWorkerId: integer("assigned_worker_id").references(
      () => workers.id,
      { onDelete: "set null" }
    ),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("conversations_laundry_idx").on(t.laundryId),
    index("conversations_customer_id_idx").on(t.customerId),
    index("conversations_phone_idx").on(t.customerPhone),
    index("conversations_status_idx").on(t.status),
    index("conversations_assigned_idx").on(t.assignedWorkerId),
    index("conversations_last_msg_idx").on(t.lastMessageAt),
  ]
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["outbound", "inbound"] }).notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["queued", "sent", "delivered", "read", "failed"],
    }),
    providerMessageId: text("provider_message_id"),
    senderType: text("sender_type", {
      enum: ["system", "worker", "owner", "customer"],
    }),
    senderId: integer("sender_id"),
    senderName: text("sender_name"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("conv_messages_conversation_idx").on(t.conversationId),
    index("conv_messages_laundry_idx").on(t.laundryId),
    index("conv_messages_created_at_idx").on(t.createdAt),
    index("conv_messages_direction_idx").on(t.direction),
  ]
);

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    workerId: integer("worker_id").references(() => workers.id, {
      onDelete: "cascade",
    }),
    isActive: boolean("is_active").notNull().default(true),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [
    index("conv_participants_conv_idx").on(t.conversationId),
    index("conv_participants_worker_idx").on(t.workerId),
  ]
);

export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
