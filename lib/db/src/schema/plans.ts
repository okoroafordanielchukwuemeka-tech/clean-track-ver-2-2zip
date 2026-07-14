/**
 * Plans — database-driven subscription plan definitions.
 *
 * These are the source of truth for plan display, pricing, and marketing copy.
 * Enforcement logic (limits, feature flags) lives in entitlements.ts for
 * performance (no DB lookup per request) but the DB records must stay in sync.
 *
 * Seed this table on first boot via scripts/seed-plans.ts.
 */
import { pgTable, serial, text, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),

  /** Matches the subscriptionTier enum on laundries: "free" | "starter" | "pro" | "business" */
  tier: text("tier").notNull().unique(),

  displayName: text("display_name").notNull(),
  tagline: text("tagline").notNull().default(""),

  /** Price in NGN, per month */
  monthlyPriceNgn: integer("monthly_price_ngn").notNull().default(0),
  /** Price in NGN, per year (0 = not offered) */
  annualPriceNgn: integer("annual_price_ngn").notNull().default(0),

  /** null means unlimited */
  maxBranches: integer("max_branches"),
  /** null means unlimited */
  maxWorkers: integer("max_workers"),
  /** null means unlimited */
  maxOrdersPerMonth: integer("max_orders_per_month"),
  /** null means unlimited */
  maxCustomers: integer("max_customers"),

  /** Feature flag map: { HAS_WHATSAPP: true, HAS_AI_MARKETING: false, ... } */
  features: jsonb("features").$type<Record<string, boolean>>().default({}),

  /** Marketing bullet points shown on the pricing page */
  marketingFeatures: jsonb("marketing_features").$type<string[]>().default([]),

  /** Whether to show a "Most Popular" badge on the pricing page */
  isHighlighted: boolean("is_highlighted").notNull().default(false),

  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
