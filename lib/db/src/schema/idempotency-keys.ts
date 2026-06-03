import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  status: text("status", { enum: ["pending", "completed"] }).notNull().default("completed"),
  statusCode: integer("status_code").notNull().default(0),
  responseBody: text("response_body"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
