import {
  pgTable, serial, integer, text, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { branches } from "./branches.js";
import { orders } from "./orders.js";
import { customers } from "./customers.js";

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    branchId: integer("branch_id").references(() => branches.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    orderId: integer("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    customerPhone: text("customer_phone"),
    customerName: text("customer_name"),
    status: text("status", {
      enum: ["pending", "dispatched", "skipped", "failed"],
    })
      .notNull()
      .default("pending"),
    skipReason: text("skip_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notif_events_laundry_idx").on(t.laundryId),
    index("notif_events_event_type_idx").on(t.eventType),
    index("notif_events_order_id_idx").on(t.orderId),
    index("notif_events_customer_id_idx").on(t.customerId),
    index("notif_events_status_idx").on(t.status),
    index("notif_events_created_at_idx").on(t.createdAt),
  ]
);

export type NotificationEvent = typeof notificationEvents.$inferSelect;
export type NewNotificationEvent = typeof notificationEvents.$inferInsert;
