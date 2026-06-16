import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const errorLog = pgTable(
  "error_log",
  {
    id: serial("id").primaryKey(),
    laundryId: integer("laundry_id"),
    requestId: text("request_id"),
    severity: text("severity", { enum: ["error", "warning"] })
      .notNull()
      .default("error"),
    message: text("message").notNull(),
    endpoint: text("endpoint"),
    method: text("method"),
    statusCode: integer("status_code"),
    stack: text("stack"),
    context: jsonb("context")
      .$type<Record<string, unknown>>()
      .default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("error_log_laundry_id_idx").on(t.laundryId),
    index("error_log_severity_idx").on(t.severity),
    index("error_log_created_at_idx").on(t.createdAt),
  ]
);

export type ErrorLogEntry = typeof errorLog.$inferSelect;
export type NewErrorLogEntry = typeof errorLog.$inferInsert;
