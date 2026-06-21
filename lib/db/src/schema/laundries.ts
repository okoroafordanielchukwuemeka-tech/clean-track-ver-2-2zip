import { pgTable, serial, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const laundries = pgTable("laundries", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull(),
  ownerEmail: text("owner_email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  subscriptionTier: text("subscription_tier", { enum: ["free", "starter", "pro", "business"] }).notNull().default("free"),
  subscriptionStatus: text("subscription_status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("trial"),
  trialStartedAt: timestamp("trial_started_at"),
  trialEndsAt: timestamp("trial_ends_at"),
  trialDurationDays: integer("trial_duration_days").notNull().default(14),
  convertedAt: timestamp("converted_at"),
  subscriptionRenewsAt: timestamp("subscription_renews_at"),
  standardTurnaroundHours: integer("standard_turnaround_hours").notNull().default(72),
  expressTurnaroundHours: integer("express_turnaround_hours").notNull().default(24),
  premiumTurnaroundHours: integer("premium_turnaround_hours").notNull().default(48),
  // ── Auth security fields ─────────────────────────────────────────────────
  // Track failed login attempts for per-account lockout (complements IP rate limiting)
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  // Used to invalidate all existing tokens when password changes
  passwordChangedAt: timestamp("password_changed_at"),
  // ── Business settings ────────────────────────────────────────────────────
  businessProfile: jsonb("business_profile").$type<{
    whatsapp?: string;
    address?: string;
    email?: string;
    logoUrl?: string;
    notes?: string;
  }>().default({}),
  brandingSettings: jsonb("branding_settings").$type<{
    brandColor?: string;
    receiptHeaderName?: string;
    receiptFooterText?: string;
  }>().default({}),
  operationalSettings: jsonb("operational_settings").$type<{
    workingDays?: string[];
    workingHoursStart?: string;
    workingHoursEnd?: string;
    requireItemVerification?: boolean;
    autoAssignOrders?: boolean;
    allowPartialPickup?: boolean;
    allowWorkersCreateCustomers?: boolean;
    allowWorkersRecordPayments?: boolean;
  }>().default({}),
  automationSettings: jsonb("automation_settings").$type<{
    orderReadyAlerts?: boolean;
    paymentReminderAlerts?: boolean;
    pickupReminderAlerts?: boolean;
    overdueAlerts?: boolean;
    dueSoonAlerts?: boolean;
  }>().default({}),
  dashboardPreferences: jsonb("dashboard_preferences").$type<{
    showRevenue?: boolean;
    showExpenses?: boolean;
    showProfit?: boolean;
    showWorkerPerformance?: boolean;
    showNotifications?: boolean;
    showOperationalInsights?: boolean;
  }>().default({}),
  discountSettings: jsonb("discount_settings").$type<{
    maxDiscountPerOrder?: number;
    maxDiscountPercentage?: number;
    autoApprovalThreshold?: number;
  }>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Laundry = typeof laundries.$inferSelect;
export type NewLaundry = typeof laundries.$inferInsert;
