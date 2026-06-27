import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  targetType: text("target_type", { enum: ["owner", "worker", "all"] }).notNull().default("owner"),
  targetWorkerId: integer("target_worker_id"),
  eventType: text("event_type", {
    enum: [
      "new_order", "order_assigned", "due_soon", "overdue",
      "payment_received", "unpaid_balance", "order_ready",
      "partial_pickup", "pickup_completed", "high_expense", "low_profit_warning",
      "whatsapp_message",
    ],
  }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  severity: text("severity", { enum: ["info", "warning", "urgent", "success"] }).notNull().default("info"),
  isRead: boolean("is_read").notNull().default(false),
  relatedOrderId: integer("related_order_id"),
  relatedConversationId: integer("related_conversation_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
