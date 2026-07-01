import {
  pgTable, serial, integer, text, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { conversations } from "./conversations.js";

export const WHATSAPP_ACTIVITY_ACTIONS = [
  "MESSAGE_SENT",
  "NOTE_ADDED",
  "CONVERSATION_RESOLVED",
  "CONVERSATION_ARCHIVED",
  "CONVERSATION_REOPENED",
  "CONVERSATION_ASSIGNED",
] as const;

export type WhatsAppActivityAction = (typeof WHATSAPP_ACTIVITY_ACTIONS)[number];

export const whatsappActivityLogs = pgTable(
  "whatsapp_activity_logs",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    actorType: text("actor_type").notNull(),
    actorId: integer("actor_id"),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    laundryIdx: index("wa_activity_laundry_idx").on(t.laundryId),
    convIdx: index("wa_activity_conv_idx").on(t.conversationId),
    actorIdx: index("wa_activity_actor_idx").on(t.actorId),
    createdAtIdx: index("wa_activity_created_at_idx").on(t.createdAt),
  })
);

export type WhatsAppActivityLog = typeof whatsappActivityLogs.$inferSelect;
export type NewWhatsAppActivityLog = typeof whatsappActivityLogs.$inferInsert;
