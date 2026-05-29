import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const laundries = pgTable("laundries", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull(),
  ownerEmail: text("owner_email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  subscriptionTier: text("subscription_tier", { enum: ["free", "starter", "pro"] }).notNull().default("free"),
  standardTurnaroundHours: integer("standard_turnaround_hours").notNull().default(72),
  expressTurnaroundHours: integer("express_turnaround_hours").notNull().default(24),
  premiumTurnaroundHours: integer("premium_turnaround_hours").notNull().default(48),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Laundry = typeof laundries.$inferSelect;
export type NewLaundry = typeof laundries.$inferInsert;
