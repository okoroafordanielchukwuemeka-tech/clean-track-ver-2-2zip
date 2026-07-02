import {
  pgTable, serial, integer, text, boolean, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const AUTOMATION_TRIGGER_EVENTS = [
  "ORDER_CREATED",
  "PAYMENT_RECEIVED",
  "ORDER_READY",
  "ORDER_COMPLETED",
  "ORDER_DELIVERED",
] as const;

export type AutomationTriggerEvent = (typeof AUTOMATION_TRIGGER_EVENTS)[number];

export const automationRules = pgTable(
  "automation_rules",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    triggerEvent: text("trigger_event").notNull(),
    messageTemplate: text("message_template").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    laundryIdx: index("automation_rules_laundry_idx").on(t.laundryId),
    uniqueTrigger: unique("automation_rules_laundry_trigger_uniq").on(
      t.laundryId,
      t.triggerEvent
    ),
  })
);

export type AutomationRule = typeof automationRules.$inferSelect;
export type NewAutomationRule = typeof automationRules.$inferInsert;
