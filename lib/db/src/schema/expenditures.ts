import { pgTable, serial, text, numeric, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const EXPENSE_CATEGORIES = [
  "electricity", "detergent", "water", "salaries",
  "transport", "maintenance", "packaging", "miscellaneous",
] as const;

export type ExpenseCategoryLegacy = typeof EXPENSE_CATEGORIES[number];

export const expenditures = pgTable("expenditures", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Expenditure = typeof expenditures.$inferSelect;
export type NewExpenditure = typeof expenditures.$inferInsert;
