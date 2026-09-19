import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { laundries } from "./laundries";
import { orders } from "./orders";
import { branches } from "./branches";
import { workers } from "./workers";

export const orderMovements = pgTable("order_movements", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  fromBranchId: integer("from_branch_id").references(() => branches.id, { onDelete: "set null" }),
  toBranchId: integer("to_branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
  movementType: text("movement_type", {
    enum: ["COLLECTION", "PROCESSING_TRANSFER", "RETURN_TRANSFER", "MANUAL_TRANSFER"],
  }).notNull(),
  reason: text("reason"),
  movedByWorkerId: integer("moved_by_worker_id").references(() => workers.id, { onDelete: "set null" }),
  movedByType: text("moved_by_type"),
  movedByName: text("moved_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("order_movements_order_idx").on(t.orderId, t.createdAt),
  index("order_movements_laundry_idx").on(t.laundryId, t.createdAt),
  index("order_movements_to_branch_idx").on(t.toBranchId, t.createdAt),
]);
