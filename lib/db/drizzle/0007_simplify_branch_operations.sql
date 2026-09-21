-- Simplify branch operations.
-- Branches remain as locations, but no longer control order workflow.
-- Orders keep legacy location columns synchronized to their single branch.

ALTER TABLE "worker_permissions"
  ADD COLUMN IF NOT EXISTS "can_view_all_branches" boolean NOT NULL DEFAULT false;

UPDATE "branches"
SET "type" = 'HYBRID',
    "processing_destination_branch_id" = NULL;

UPDATE "orders"
SET
  "branch_id" = COALESCE("current_branch_id", "collection_branch_id", "branch_id"),
  "collection_branch_id" = COALESCE("current_branch_id", "collection_branch_id", "branch_id"),
  "processing_branch_id" = COALESCE("current_branch_id", "collection_branch_id", "branch_id"),
  "return_branch_id" = COALESCE("current_branch_id", "collection_branch_id", "branch_id"),
  "current_branch_id" = COALESCE("current_branch_id", "collection_branch_id", "branch_id")
WHERE "branch_id" IS NOT NULL
   OR "current_branch_id" IS NOT NULL
   OR "collection_branch_id" IS NOT NULL;
