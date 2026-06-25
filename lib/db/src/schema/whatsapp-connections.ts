import {
  pgTable, serial, integer, text, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const WA_CONNECTION_STATUSES = ["connected", "disconnected", "error"] as const;
export type WaConnectionStatus = (typeof WA_CONNECTION_STATUSES)[number];

/**
 * Stores WhatsApp Business connection state per laundry.
 * Designed for the Meta Embedded Signup flow — the owner never sees raw tokens.
 * The access token is AES-256-GCM encrypted before storage.
 */
export const whatsappConnections = pgTable(
  "whatsapp_connections",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id")
      .notNull()
      .references(() => laundries.id, { onDelete: "cascade" }),

    /** Meta WhatsApp Business Account ID (WABA ID) */
    whatsappBusinessAccountId: text("whatsapp_business_account_id").notNull(),

    /** Meta Phone Number ID (used to send messages) */
    phoneNumberId: text("phone_number_id").notNull(),

    /**
     * AES-256-GCM encrypted access token.
     * Format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
     * Key is derived from BACKUP_SECRET via SHA-256.
     */
    encryptedAccessToken: text("encrypted_access_token").notNull(),

    /** Human-readable phone number, e.g. "+234 801 234 5678" */
    displayPhoneNumber: text("display_phone_number"),

    /** WhatsApp Business display name */
    businessName: text("business_name"),

    status: text("status", { enum: WA_CONNECTION_STATUSES })
      .notNull()
      .default("connected"),

    connectedAt: timestamp("connected_at").notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wa_connections_laundry_uidx").on(t.laundryId),
    index("wa_connections_laundry_idx").on(t.laundryId),
  ]
);

export type WhatsappConnection = typeof whatsappConnections.$inferSelect;
export type NewWhatsappConnection = typeof whatsappConnections.$inferInsert;
