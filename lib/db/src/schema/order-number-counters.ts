import { pgTable, text, integer } from "drizzle-orm/pg-core";

/**
 * Atomic daily counter for human-friendly order IDs.
 * Format: ORD-YYMMDD-NNN (e.g. ORD-260720-001)
 * One row per calendar day; counter increments atomically via INSERT ON CONFLICT DO UPDATE.
 */
export const orderNumberCounters = pgTable("order_number_counters", {
  datePart: text("date_part").primaryKey(), // YYMMDD
  counter: integer("counter").notNull().default(0),
});

export type OrderNumberCounter = typeof orderNumberCounters.$inferSelect;
