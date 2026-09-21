import pg from "pg";

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

try {
  await client.connect();

  const [branchIdColumn] = await q(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'branch_id'
  `);

  const [branchIdForeignKey] = await q(`
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'orders'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'branch_id'
  `);

  const [orderStats] = await q(`
    SELECT
      COUNT(*)::int AS total_orders,
      COUNT(*) FILTER (WHERE branch_id IS NULL)::int AS unassigned_orders,
      COUNT(*) FILTER (WHERE branch_id IS NOT NULL)::int AS assigned_orders,
      COUNT(*) FILTER (
        WHERE branch_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.branches b
            WHERE b.id = orders.branch_id
              AND b.laundry_id = orders.laundry_id
          )
      )::int AS invalid_tenant_branch_refs
    FROM public.orders
  `);

  const [branchStats] = await q(`
    SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS active_branches,
      COUNT(*)::int AS total_branches
    FROM public.branches
  `);

  const [legacyStructures] = await q(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='branches' AND column_name='type'
      ) AS branches_type_present,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='branches' AND column_name='processing_destination_branch_id'
      ) AS processing_destination_present,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orders' AND column_name='collection_branch_id'
      ) AS collection_branch_present,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orders' AND column_name='processing_branch_id'
      ) AS processing_branch_present,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orders' AND column_name='return_branch_id'
      ) AS return_branch_present,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='orders' AND column_name='current_branch_id'
      ) AS current_branch_present,
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='order_movements'
      ) AS order_movements_present
  `);

  const [migrationTable] = await q(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='__drizzle_migrations'
    ) AS exists
  `);

  let migrations = [];
  if (migrationTable?.exists) {
    migrations = await q(`
      SELECT id, hash, created_at
      FROM public.__drizzle_migrations
      ORDER BY created_at, id
    `);
  }

  const report = {
    branch_id: {
      column_present: Boolean(branchIdColumn),
      foreign_key_present: Boolean(branchIdForeignKey),
    },
    orders: orderStats,
    branches: branchStats,
    legacy_structures: legacyStructures,
    migrations_applied: migrations.map(m => ({ id: m.id, hash: m.hash, created_at: m.created_at })),
  };

  console.log("[branch-integrity] READ-ONLY production check");
  console.log("[branch-integrity] SUMMARY", JSON.stringify(report));

  if (!branchIdColumn || !branchIdForeignKey) {
    throw new Error("orders.branch_id or its foreign key is missing");
  }
  if (Number(orderStats.invalid_tenant_branch_refs) !== 0) {
    throw new Error("orders contains cross-tenant branch references");
  }

  if (Number(orderStats.unassigned_orders) > 0) {
    console.warn(
      "[branch-integrity] WARNING: unassigned orders remain and require explicit owner assignment before final branch cleanup",
      JSON.stringify({ unassignedOrders: orderStats.unassigned_orders }),
    );
  }

  console.log("[branch-integrity] Verification complete. No data was changed.");
} catch (err) {
  console.error("[branch-integrity] FAILED:", err?.message ?? String(err));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
