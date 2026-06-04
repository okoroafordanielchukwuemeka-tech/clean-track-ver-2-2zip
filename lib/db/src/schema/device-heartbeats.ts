import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";
import { branches } from "./branches.js";
import { workers } from "./workers.js";

export const deviceHeartbeats = pgTable("device_heartbeats", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branches.id, { onDelete: "set null" }),
  workerId: integer("worker_id").references(() => workers.id, { onDelete: "set null" }),
  actorType: text("actor_type", { enum: ["owner", "worker"] }).notNull().default("worker"),
  workerName: text("worker_name"),
  deviceId: text("device_id").notNull(),
  pendingCount: integer("pending_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  conflictCount: integer("conflict_count").notNull().default(0),
  recoveryCount: integer("recovery_count").notNull().default(0),
  isOnline: boolean("is_online").notNull().default(true),
  appVersion: text("app_version"),
  lastSyncedAt: timestamp("last_synced_at"),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  laundryDeviceUniq: uniqueIndex("device_heartbeats_laundry_device_uniq").on(
    table.laundryId,
    table.deviceId
  ),
}));

export type DeviceHeartbeat = typeof deviceHeartbeats.$inferSelect;
export type NewDeviceHeartbeat = typeof deviceHeartbeats.$inferInsert;
