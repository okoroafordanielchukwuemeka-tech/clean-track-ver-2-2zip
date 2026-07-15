import { pgTable, serial, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  standardPrice: numeric("standard_price", { precision: 10, scale: 2 }).notNull(),
  expressPrice: numeric("express_price", { precision: 10, scale: 2 }),
  premiumPrice: numeric("premium_price", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  // Phase 7.10: Service Catalog & Image Management
  // imageUrl holds ONE of: null (no image — client suggests a default icon by
  // name match), "icon:<key>" (owner explicitly picked a bundled default icon),
  // or a real uploaded file URL served by the storage abstraction. The DB never
  // stores image binaries — only this reference.
  imageUrl: text("image_url"),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
