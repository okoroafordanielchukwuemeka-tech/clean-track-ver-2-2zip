import {
  pgTable, serial, integer, text, boolean, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { branches } from "./branches.js";

export const NOTIFICATION_CHANNELS = ["whatsapp", "sms", "email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_EVENT_TRIGGERS = [
  "order_received",
  "order_ready",
  "order_delivered",
  "pickup_reminder",
  "payment_reminder",
] as const;
export type NotificationEventTrigger = (typeof NOTIFICATION_EVENT_TRIGGERS)[number];

export const NOTIFICATION_TRIGGER_LABELS: Record<NotificationEventTrigger, string> = {
  order_received: "Order Received",
  order_ready: "Order Ready for Pickup",
  order_delivered: "Order Delivered / Picked Up",
  pickup_reminder: "Pickup Reminder",
  payment_reminder: "Payment Reminder",
};

export const NOTIFICATION_VARIABLES = [
  "customer_name",
  "order_number",
  "branch_name",
  "balance",
  "amount_paid",
  "total_due",
  "service_type",
  "business_name",
  "pickup_date",
  // ── Payment details (Phase 7.9) — sourced from businessProfile.paymentDetails ──
  "bank_name",
  "account_name",
  "account_number",
  "payment_reference",
  "payment_instructions",
] as const;
export type NotificationVariable = (typeof NOTIFICATION_VARIABLES)[number];

export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    branchId: integer("branch_id").references(() => branches.id, {
      onDelete: "set null",
    }),
    eventTrigger: text("event_trigger", {
      enum: NOTIFICATION_EVENT_TRIGGERS,
    }).notNull(),
    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    name: text("name").notNull(),
    body: text("body").notNull(),
    variables: jsonb("variables")
      .$type<string[]>()
      .default([]),
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("notif_templates_laundry_idx").on(t.laundryId),
    index("notif_templates_trigger_idx").on(t.eventTrigger),
    index("notif_templates_channel_idx").on(t.channel),
    index("notif_templates_active_idx").on(t.isActive),
  ]
);

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplate = typeof notificationTemplates.$inferInsert;

export const DEFAULT_NOTIFICATION_TEMPLATES: Array<{
  eventTrigger: NotificationEventTrigger;
  channel: NotificationChannel;
  name: string;
  body: string;
  variables: string[];
}> = [
  {
    eventTrigger: "order_received",
    channel: "whatsapp",
    name: "Order Received (WhatsApp)",
    body: "Hi {{customer_name}} 👋\n\nYour laundry order *#{{order_number}}* has been received at *{{branch_name}}*.\n\nService: {{service_type}}\nTotal: {{total_due}}\n\nWe'll notify you as soon as it's ready. Thank you for choosing {{business_name}}! 🧺",
    variables: ["customer_name", "order_number", "branch_name", "service_type", "total_due", "business_name"],
  },
  {
    eventTrigger: "order_ready",
    channel: "whatsapp",
    name: "Order Ready (WhatsApp)",
    body: "Hi {{customer_name}} ✅\n\nGreat news! Your laundry order *#{{order_number}}* is ready for pickup at *{{branch_name}}*.\n\nBalance Due: *{{balance}}*\n\nPlease come in at your earliest convenience. See you soon! 🎉",
    variables: ["customer_name", "order_number", "branch_name", "balance"],
  },
  {
    eventTrigger: "order_delivered",
    channel: "whatsapp",
    name: "Order Delivered (WhatsApp)",
    body: "Hi {{customer_name}} 🎊\n\nYour laundry order *#{{order_number}}* has been successfully picked up.\n\nThank you for choosing *{{business_name}}*! We look forward to serving you again.",
    variables: ["customer_name", "order_number", "business_name"],
  },
  {
    eventTrigger: "pickup_reminder",
    channel: "whatsapp",
    name: "Pickup Reminder (WhatsApp)",
    body: "Hi {{customer_name}} ⏰\n\nFriendly reminder — your laundry order *#{{order_number}}* has been ready at *{{branch_name}}* and is still awaiting pickup.\n\nBalance: *{{balance}}*\n\nPlease collect your items at your earliest convenience. Thank you!",
    variables: ["customer_name", "order_number", "branch_name", "balance"],
  },
  {
    eventTrigger: "payment_reminder",
    channel: "whatsapp",
    name: "Payment Reminder (WhatsApp)",
    body: "Hi {{customer_name}} 💳\n\nThis is a gentle reminder that you have an outstanding balance of *{{balance}}* for order *#{{order_number}}* at *{{branch_name}}*.\n\nAmount Paid: {{amount_paid}}\nTotal Due: {{total_due}}\n\nPay to:\n*{{bank_name}}*\nAccount Name: {{account_name}}\nAccount Number: {{account_number}}\nReference: {{payment_reference}}\n\n{{payment_instructions}}\n\nThank you!",
    variables: ["customer_name", "order_number", "branch_name", "balance", "amount_paid", "total_due", "bank_name", "account_name", "account_number", "payment_reference", "payment_instructions"],
  },
];
