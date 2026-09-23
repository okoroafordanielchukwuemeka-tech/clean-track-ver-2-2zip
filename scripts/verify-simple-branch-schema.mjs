#!/usr/bin/env node
// Read-only verification for CleanTrack's final simple branch architecture.
import pg from "pg";

const { Client } = pg;
const client = new Client({
  connectionString: process.env.EXTERNAL_DATABASE_URL ?? process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

try {
  await client.connect();

  const [ordersBranch] = await q(
    "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='branch_id'"
  );
  const [workersBranch] = await q(
    "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='workers' AND column_name='branch_id'"
  );

  const fks = await q(
    "SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema WHERE tc.table_schema='public' AND tc.constraint_type='FOREIGN KEY' AND ((tc.table_name='orders' AND kcu.column_name='branch_id') OR (tc.table_name='workers' AND kcu.column_name='branch_id'))"
  );

  const [integrity] = await q(
    "SELECT (SELECT COUNT(*) FROM public.orders)::int AS total_orders, (SELECT COUNT(*) FROM public.orders WHERE branch_id IS NULL)::int AS unassigned_orders, (SELECT COUNT(*) FROM public.workers)::int AS total_workers, (SELECT COUNT(*) FROM public.workers WHERE branch_id IS NULL)::int AS unassigned_workers, (SELECT COUNT(*) FROM public.orders o WHERE o.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=o.branch_id AND b.laundry_id=o.laundry_id))::int AS invalid_order_branch_refs, (SELECT COUNT(*) FROM public.workers w WHERE w.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=w.branch_id AND b.laundry_id=w.laundry_id))::int AS invalid_worker_branch_refs"
  );

  const [legacy] = await q(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='branches' AND column_name='type') AS branches_type, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='branches' AND column_name='processing_destination_branch_id') AS processing_destination, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='collection_branch_id') AS collection_branch, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='processing_branch_id') AS processing_branch, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='return_branch_id') AS return_branch, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='current_branch_id') AS current_branch, EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='order_movements') AS order_movements"
  );

  console.log(JSON.stringify({
    sourceOfTruth: ["workers.branch_id -> branches.id", "orders.branch_id -> branches.id"],
    ordersBranch,
    workersBranch,
    foreignKeys: fks,
    integrity,
    retiredStructuresPresent: legacy,
  }, null, 2));

  if (!ordersBranch || !workersBranch) throw new Error("Required branch source-of-truth columns are missing");
  if (fks.length < 2) throw new Error("Required branch foreign keys are incomplete");
  if (Number(integrity.invalid_order_branch_refs) !== 0) throw new Error("Cross-tenant order branch references found");
  if (Number(integrity.invalid_worker_branch_refs) !== 0) throw new Error("Cross-tenant worker branch references found");

  console.log("[simple-branch] READ-ONLY verification passed. No data was changed.");
} catch (err) {
  console.error("[simple-branch] FAILED:", err?.message ?? String(err));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
