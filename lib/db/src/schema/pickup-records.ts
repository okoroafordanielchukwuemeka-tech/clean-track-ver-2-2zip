import { pgTable, serial, integer, text, timestamp, json } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { workers } from "./workers.js";
import { laundries } from "./laundries.js";

export const pickupRecords = pgTable("pickup_records", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  shirtsPickedUp: integer("shirts_picked_up").notNull().default(0),
  trousersPickedUp: integer("trousers_picked_up").notNull().default(0),
  itemPickups: json("item_pickups").$type<{ orderItemId: number; quantity: number; name: string }[]>(),
  notes: text("notes"),
  processedBy: integer("processed_by").references(() => workers.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PickupRecord = typeof pickupRecords.$inferSelect;
export type NewPickupRecord = typeof pickupRecords.$inferInsert;
