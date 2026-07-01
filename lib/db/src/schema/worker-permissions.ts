import { pgTable, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { workers } from "./workers.js";
import { laundries } from "./laundries.js";

export const workerPermissions = pgTable("worker_permissions", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => workers.id, { onDelete: "cascade" }).unique(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  canViewCustomers: boolean("can_view_customers").notNull().default(true),
  canCreateCustomers: boolean("can_create_customers").notNull().default(false),
  canViewCustomerBalances: boolean("can_view_customer_balances").notNull().default(false),
  canRecordPayments: boolean("can_record_payments").notNull().default(false),
  canRecordPickups: boolean("can_record_pickups").notNull().default(true),
  canViewOrders: boolean("can_view_orders").notNull().default(true),
  canProcessOrders: boolean("can_process_orders").notNull().default(true),
  canAssignOrders: boolean("can_assign_orders").notNull().default(false),
  canViewWhatsApp: boolean("can_view_whatsapp").notNull().default(false),
  canReplyWhatsApp: boolean("can_reply_whatsapp").notNull().default(false),
  canManageWhatsApp: boolean("can_manage_whatsapp").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkerPermission = typeof workerPermissions.$inferSelect;
export type NewWorkerPermission = typeof workerPermissions.$inferInsert;

export const ADMIN_DEFAULT_PERMISSIONS = {
  canViewCustomers: true,
  canCreateCustomers: true,
  canViewCustomerBalances: true,
  canRecordPayments: true,
  canRecordPickups: true,
  canViewOrders: true,
  canProcessOrders: true,
  canAssignOrders: true,
  canViewWhatsApp: false,
  canReplyWhatsApp: false,
  canManageWhatsApp: false,
};

export const WORKER_DEFAULT_PERMISSIONS = {
  canViewCustomers: false,
  canCreateCustomers: false,
  canViewCustomerBalances: false,
  canRecordPayments: false,
  canRecordPickups: false,
  canViewOrders: false,
  canProcessOrders: false,
  canAssignOrders: false,
  canViewWhatsApp: false,
  canReplyWhatsApp: false,
  canManageWhatsApp: false,
};
