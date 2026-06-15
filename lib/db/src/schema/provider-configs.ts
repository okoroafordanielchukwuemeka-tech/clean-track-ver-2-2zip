import {
  pgTable, serial, integer, text, boolean, jsonb, timestamp,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const PROVIDER_NAMES = ["whatsapp", "sms", "email", "push"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** WhatsApp Cloud API (Meta) configuration — stored per laundry */
export interface WhatsAppProviderConfig {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId: string;
  webhookVerifyToken: string;
  /** Meta App Secret — used to verify X-Hub-Signature-256 on inbound webhooks */
  appSecret?: string;
  apiVersion?: string;          // default: v21.0
  displayPhoneNumber?: string;  // populated after verification
  verifiedName?: string;        // populated after verification
  qualityRating?: string;       // populated after verification
}

export const providerConfigs = pgTable(
  "provider_configs",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: PROVIDER_NAMES }).notNull(),
    /** All provider secrets/settings stored as JSONB */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(false),
    isVerified: boolean("is_verified").notNull().default(false),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestResult: text("last_test_result"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_configs_laundry_provider_uidx").on(t.laundryId, t.provider),
    index("provider_configs_laundry_idx").on(t.laundryId),
  ]
);

export type ProviderConfig = typeof providerConfigs.$inferSelect;
export type NewProviderConfig = typeof providerConfigs.$inferInsert;
