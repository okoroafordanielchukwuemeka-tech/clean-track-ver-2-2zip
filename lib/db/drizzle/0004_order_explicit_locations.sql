-- Phase 2.1: introduce explicit order lifecycle locations safely.
-- Keep legacy branch_id intact until all order routes and views have migrated.
-- This migration is intentionally additive and reversible at the application layer.

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "collection_branch_id" integer
    REFERENCES "branches"("id") ON DELETE SET NULL;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "processing_branch_id" integer
    REFERENCES "branches"("id") ON DELETE SET NULL;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "return_branch_id" integer
    REFERENCES "branches"("id") ON DELETE SET NULL;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "current_branch_id" integer
    REFERENCES "branches"("id") ON DELETE SET NULL;

-- Backfill existing orders from the legacy single branch location.
-- We deliberately do not invent a branch for orders whose branch_id is NULL.
UPDATE "orders"
SET
  "collection_branch_id" = "branch_id",
  "processing_branch_id" = "branch_id",
  "return_branch_id" = "branch_id",
  "current_branch_id" = "branch_id"
WHERE "branch_id" IS NOT NULL
  AND "collection_branch_id" IS NULL
  AND "processing_branch_id" IS NULL
  AND "return_branch_id" IS NULL
  AND "current_branch_id" IS NULL;

CREATE INDEX IF NOT EXISTS "orders_collection_branch_id_idx"
  ON "orders" ("collection_branch_id");

CREATE INDEX IF NOT EXISTS "orders_processing_branch_id_idx"
  ON "orders" ("processing_branch_id");

CREATE INDEX IF NOT EXISTS "orders_return_branch_id_idx"
  ON "orders" ("return_branch_id");

CREATE INDEX IF NOT EXISTS "orders_current_branch_id_idx"
  ON "orders" ("current_branch_id");

CREATE INDEX IF NOT EXISTS "orders_laundry_collection_branch_idx"
  ON "orders" ("laundry_id", "collection_branch_id");

CREATE INDEX IF NOT EXISTS "orders_laundry_processing_branch_idx"
  ON "orders" ("laundry_id", "processing_branch_id");

CREATE INDEX IF NOT EXISTS "orders_laundry_return_branch_idx"
  ON "orders" ("laundry_id", "return_branch_id");

CREATE INDEX IF NOT EXISTS "orders_laundry_current_branch_idx"
  ON "orders" ("laundry_id", "current_branch_id");
