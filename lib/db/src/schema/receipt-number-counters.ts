import { pgTable, text, integer } from "drizzle-orm/pg-core";

export const receiptNumberCounters = pgTable("receipt_number_counters", {
  datePart: text("date_part").primaryKey(),
  counter: integer("counter").notNull().default(0),
});

export type ReceiptNumberCounter = typeof receiptNumberCounters.$inferSelect;
