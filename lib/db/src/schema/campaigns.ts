import {
  pgTable, serial, integer, text, timestamp, index,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { branches } from "./branches.js";
import { customers } from "./customers.js";

export const CAMPAIGN_TYPES = [
  "promotion",
  "reminder",
  "announcement",
  "holiday_greeting",
  "win_back",
  "custom",
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CAMPAIGN_AUDIENCE_TYPES = [
  "all",
  "vip",
  "repeat",
  "inactive_30",
  "inactive_60",
  "inactive_90",
  "outstanding_balance",
  "ready_pickup",
  "completed_orders",
  "custom_tag",
  "custom_selection",
] as const;
export type CampaignAudienceType = (typeof CAMPAIGN_AUDIENCE_TYPES)[number];

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "queued",
  "sending",
  "sent",
  "failed",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_SCHEDULE_TYPES = [
  "now",
  "scheduled",
  "recurring_weekly",
  "recurring_monthly",
] as const;
export type CampaignScheduleType = (typeof CAMPAIGN_SCHEDULE_TYPES)[number];

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branches.id, { onDelete: "set null" }),

  name: text("name").notNull(),
  type: text("type", { enum: CAMPAIGN_TYPES }).notNull().default("promotion"),

  audienceType: text("audience_type", { enum: CAMPAIGN_AUDIENCE_TYPES }).notNull().default("all"),
  audienceFilter: text("audience_filter"), // JSON: { tag?: string; customerIds?: number[] }

  messageTitle: text("message_title"),
  messageBody: text("message_body").notNull(),

  scheduleType: text("schedule_type", { enum: CAMPAIGN_SCHEDULE_TYPES }).notNull().default("now"),
  scheduledAt: timestamp("scheduled_at"),
  timezone: text("timezone").default("Africa/Lagos"),

  status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),

  totalRecipients: integer("total_recipients").notNull().default(0),
  delivered: integer("delivered").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  cancelled: integer("cancelled").notNull().default(0),

  createdById: integer("created_by_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("campaigns_laundry_id_idx").on(t.laundryId),
  index("campaigns_status_idx").on(t.status),
  index("campaigns_scheduled_at_idx").on(t.scheduledAt),
  index("campaigns_laundry_status_idx").on(t.laundryId, t.status),
]);

export const CAMPAIGN_RECIPIENT_STATUSES = [
  "queued",
  "sending",
  "delivered",
  "failed",
  "cancelled",
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

export const campaignRecipients = pgTable("campaign_recipients", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").references(() => customers.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  message: text("message").notNull(),

  status: text("status", { enum: CAMPAIGN_RECIPIENT_STATUSES }).notNull().default("queued"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  failedAt: timestamp("failed_at"),
  errorMessage: text("error_message"),
  retries: integer("retries").notNull().default(0),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("camp_recipients_campaign_idx").on(t.campaignId),
  index("camp_recipients_status_idx").on(t.status),
  index("camp_recipients_phone_idx").on(t.phone),
]);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type NewCampaignRecipient = typeof campaignRecipients.$inferInsert;
