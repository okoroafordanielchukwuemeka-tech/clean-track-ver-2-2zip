import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  statusCode: integer("status_code").notNull(),
  responseBody: text("response_body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
