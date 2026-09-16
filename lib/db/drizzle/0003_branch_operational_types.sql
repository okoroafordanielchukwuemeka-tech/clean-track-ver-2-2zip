-- Add branch operational type without changing existing branch behavior.
-- Existing branches become HYBRID so current collection, processing, and return flows remain valid.
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'HYBRID';

ALTER TABLE "branches"
  DROP CONSTRAINT IF EXISTS "branches_type_check";

ALTER TABLE "branches"
  ADD CONSTRAINT "branches_type_check"
  CHECK ("type" IN ('PROCESSING', 'PICKUP', 'HYBRID'));

CREATE INDEX IF NOT EXISTS "branches_laundry_type_idx"
  ON "branches" ("laundry_id", "type");
