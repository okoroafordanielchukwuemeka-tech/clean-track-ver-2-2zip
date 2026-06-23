import { pgTable, serial, integer, varchar, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const nudgeLog = pgTable("nudge_log", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  ownerEmail: varchar("owner_email", { length: 255 }).notNull(),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  stuckStage: varchar("stuck_stage", { length: 100 }).notNull(),
  nudgeType: varchar("nudge_type", { length: 20 }).notNull(), // "24h" | "48h" | "7d"
  trackingToken: varchar("tracking_token", { length: 64 }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  activatedAfter: boolean("activated_after").notNull().default(false),
}, (t) => [
  unique("nudge_log_uniq").on(t.laundryId, t.stuckStage, t.nudgeType),
  index("nudge_log_laundry_id_idx").on(t.laundryId),
  index("nudge_log_sent_at_idx").on(t.sentAt),
  index("nudge_log_tracking_token_idx").on(t.trackingToken),
]);

export type NudgeLog = typeof nudgeLog.$inferSelect;
export type NewNudgeLog = typeof nudgeLog.$inferInsert;

export const NUDGE_TYPES = ["24h", "48h", "7d"] as const;
export type NudgeType = typeof NUDGE_TYPES[number];

export const STUCK_STAGE_LABELS: Record<string, string> = {
  "no_branch": "No branch created",
  "no_services": "No services added",
  "no_customer": "No customer created",
  "no_order": "No order created",
  "no_completion": "No completed order",
};
