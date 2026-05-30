import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;

export const DEFAULT_MESSAGE_TEMPLATES = [
  {
    name: "order_ready",
    subject: "Order Ready for Pickup",
    body: "Hello {{customer_name}}, your laundry order #{{order_id}} is ready for pickup. Please come in at your earliest convenience.",
  },
  {
    name: "payment_reminder",
    subject: "Payment Reminder",
    body: "Hello {{customer_name}}, you have an outstanding balance of {{balance}} for order #{{order_id}}. Please make payment at your earliest convenience.",
  },
  {
    name: "pickup_reminder",
    subject: "Pickup Reminder",
    body: "Hello {{customer_name}}, your laundry items for order #{{order_id}} are still awaiting pickup. Please collect them soon.",
  },
  {
    name: "overdue_alert",
    subject: "Order Overdue Notice",
    body: "Hello {{customer_name}}, your order #{{order_id}} is overdue. Please contact us for assistance.",
  },
  {
    name: "due_soon_alert",
    subject: "Order Due Soon",
    body: "Hello {{customer_name}}, your order #{{order_id}} will be ready in approximately {{hours_left}} hours.",
  },
];
