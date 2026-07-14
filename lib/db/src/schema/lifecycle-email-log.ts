/**
 * Lifecycle Email Log — deduplication guard for automated lifecycle emails.
 *
 * Each (laundry_id, email_type) pair is unique.  The scheduler inserts a row
 * before sending; if the insert fails (duplicate) the email is skipped.
 * This prevents re-sends after server restarts or scheduler retries.
 */
import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const LIFECYCLE_EMAIL_TYPES = [
  // Trial sequence
  "trial_day2",
  "trial_day4",
  "trial_day6",
  "trial_day8",
  "trial_day10",
  "trial_day12",
  "trial_day13",
  "trial_day14_expired",
  // Renewal reminders
  "renewal_7d",
  "renewal_3d",
  "renewal_1d",
  // Payment events
  "payment_successful",
  "payment_failed_immediate",
  "payment_failed_24h",
  "payment_failed_72h",
  // Cancellation
  "cancellation_retention",
] as const;

export type LifecycleEmailType = (typeof LIFECYCLE_EMAIL_TYPES)[number];

export const lifecycleEmailLog = pgTable(
  "lifecycle_email_log",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    emailType: text("email_type").notNull(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    /** Recipient address at time of send (owner may change email) */
    toEmail: text("to_email").notNull(),
    /** Optional metadata: { daysInTrial: 2, trialEndsAt: "..." } */
    meta: text("meta"),
  },
  (t) => ({
    uniq: unique("lifecycle_email_log_laundry_type_unique").on(t.laundryId, t.emailType),
  })
);

export type LifecycleEmailLog = typeof lifecycleEmailLog.$inferSelect;
export type NewLifecycleEmailLog = typeof lifecycleEmailLog.$inferInsert;
