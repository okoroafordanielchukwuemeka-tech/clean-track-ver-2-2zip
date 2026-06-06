import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { SUBSCRIPTION_STATUSES } from "./laundries.js";

export const subscriptionLogs = pgTable(
  "subscription_logs",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
    fromStatus: text("from_status", { enum: SUBSCRIPTION_STATUSES }),
    toStatus: text("to_status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
    fromPlan: text("from_plan"),
    toPlan: text("to_plan"),
    reason: text("reason"),
    changedBy: text("changed_by").notNull().default("system"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("sub_logs_laundry_id_idx").on(t.laundryId),
    index("sub_logs_created_at_idx").on(t.createdAt),
  ]
);

export type SubscriptionLog = typeof subscriptionLogs.$inferSelect;
export type NewSubscriptionLog = typeof subscriptionLogs.$inferInsert;
