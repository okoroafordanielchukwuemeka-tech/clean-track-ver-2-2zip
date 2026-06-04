import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
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
}, (t) => [
  index("audit_log_laundry_id_idx").on(t.laundryId),
  index("audit_log_created_at_idx").on(t.createdAt),
  index("audit_log_action_idx").on(t.action),
  index("audit_log_order_id_idx").on(t.orderId),
]);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
