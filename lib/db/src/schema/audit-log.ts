import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").references(() => laundries.id, { onDelete: "cascade" }),
  actorId: integer("actor_id"),
  actorType: text("actor_type", { enum: ["owner", "worker"] }).notNull(),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  orderId: integer("order_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
