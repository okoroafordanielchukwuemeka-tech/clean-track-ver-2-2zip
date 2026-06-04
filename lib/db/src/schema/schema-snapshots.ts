import { pgTable, serial, integer, text, bigint, timestamp } from "drizzle-orm/pg-core";

export const schemaSnapshots = pgTable("schema_snapshots", {
  id: serial("id").primaryKey(),
  snapshotType: text("snapshot_type").notNull(),
  triggeredBy: text("triggered_by"),
  tableCount: integer("table_count"),
  indexCount: integer("index_count"),
  dbSizeBytes: bigint("db_size_bytes", { mode: "number" }),
  tableList: text("table_list"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
