import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const adminAuditLog = pgTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull(),
  adminName: text("admin_name").notNull(),
  adminEmail: text("admin_email").notNull(),
  action: text("action").notNull(),
  targetLaundryId: integer("target_laundry_id"),
  targetLaundryName: text("target_laundry_name"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;

export const ADMIN_ACTIONS = {
  LOGIN: "admin_login",
  LOGOUT: "admin_logout",
  IMPERSONATE: "impersonate_tenant",
  PLAN_CHANGE: "plan_change",
  STATUS_CHANGE: "status_change",
  TRIAL_EXTEND: "trial_extend",
  SUSPEND: "suspend_account",
  ACTIVATE: "activate_account",
  CANCEL: "cancel_account",
} as const;
