-- Phase 2.2: explicit order movement history.
-- Additive only. The legacy orders.branch_id and explicit location columns remain intact.

CREATE TABLE IF NOT EXISTS "order_movements" (
  "id" serial PRIMARY KEY NOT NULL,
  "laundry_id" integer NOT NULL REFERENCES "laundries"("id") ON DELETE CASCADE,
  "order_id" integer NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "from_branch_id" integer REFERENCES "branches"("id") ON DELETE SET NULL,
  "to_branch_id" integer NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "movement_type" text NOT NULL CHECK ("movement_type" IN ('COLLECTION','PROCESSING_TRANSFER','RETURN_TRANSFER','MANUAL_TRANSFER')),
  "reason" text,
  "moved_by_worker_id" integer REFERENCES "workers"("id") ON DELETE SET NULL,
  "moved_by_type" text,
  "moved_by_name" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "order_movements_order_idx"
  ON "order_movements" ("order_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_movements_laundry_idx"
  ON "order_movements" ("laundry_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_movements_to_branch_idx"
  ON "order_movements" ("to_branch_id", "created_at");
