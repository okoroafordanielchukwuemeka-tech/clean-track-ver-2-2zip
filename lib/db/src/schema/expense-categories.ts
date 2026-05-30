import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const expenseCategories = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type NewExpenseCategory = typeof expenseCategories.$inferInsert;

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Electricity",
  "Water",
  "Detergent",
  "Salaries",
  "Transport",
  "Maintenance",
  "Packaging",
  "Miscellaneous",
];
