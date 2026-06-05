import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { branches } from "./branches.js";

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export const ALERT_CATEGORIES = [
  "sync",
  "backup",
  "recovery",
  "payment",
  "pickup",
  "worker",
  "system",
  "version",
  "security",
] as const;
export const ALERT_STATUSES = ["open", "acknowledged", "resolved"] as const;

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id").references(() => laundries.id, {
      onDelete: "cascade",
    }),
    branchId: integer("branch_id").references(() => branches.id, {
      onDelete: "set null",
    }),
    deviceId: text("device_id"),
    severity: text("severity", { enum: ALERT_SEVERITIES }).notNull(),
    category: text("category", { enum: ALERT_CATEGORIES }).notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    status: text("status", { enum: ALERT_STATUSES })
      .notNull()
      .default("open"),
    fingerprint: text("fingerprint"),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("alerts_laundry_id_idx").on(t.laundryId),
    index("alerts_status_idx").on(t.status),
    index("alerts_severity_idx").on(t.severity),
    index("alerts_category_idx").on(t.category),
    index("alerts_created_at_idx").on(t.createdAt),
    index("alerts_fingerprint_idx").on(t.fingerprint),
  ]
);

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
