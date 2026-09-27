-- Gate 1: worker multi-branch access foundation.
-- This migration is intentionally independent of the unapproved 0007 migration.
-- DO NOT run 0007 as part of this change.

CREATE TABLE IF NOT EXISTS "worker_branch_access" (
  "id" serial PRIMARY KEY NOT NULL,
  "worker_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "worker_branch_access_worker_id_workers_id_fk"
    FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade,
  CONSTRAINT "worker_branch_access_branch_id_branches_id_fk"
    FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worker_branch_access_worker_branch_uq"
  ON "worker_branch_access" USING btree ("worker_id", "branch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_branch_access_worker_id_idx"
  ON "worker_branch_access" USING btree ("worker_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_branch_access_branch_id_idx"
  ON "worker_branch_access" USING btree ("branch_id");
