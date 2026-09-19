-- Phase 2.3: branch-configured processing destinations.
-- A pickup branch must explicitly point to a processing-capable branch.
-- Hybrid branches process locally by default; processing branches cannot collect.
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "processing_destination_branch_id" integer
  REFERENCES "branches"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "branches_processing_destination_idx"
  ON "branches" ("processing_destination_branch_id");

-- Existing branches were created before explicit routing existed. HYBRID is the
-- safe default and therefore needs no destination. PICKUP branches, if any,
-- must be configured by the owner before new orders can be created.
