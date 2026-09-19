import pg from "pg";

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

try {
  await client.connect();

  const columns = await q(`
    SELECT c.column_name, c.data_type,
           EXISTS (
             SELECT 1
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_schema = 'public'
               AND tc.table_name = 'orders'
               AND kcu.column_name = c.column_name
           ) AS has_fk
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'orders'
      AND c.column_name IN (
        'branch_id','collection_branch_id','processing_branch_id',
        'return_branch_id','current_branch_id'
      )
    ORDER BY c.ordinal_position
  `);

  const migrationTable = await q(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='__drizzle_migrations'
    ) AS exists
  `);

  let migrations = [];
  if (migrationTable[0]?.exists) {
    migrations = await q(`
      SELECT id, hash, created_at
      FROM public.__drizzle_migrations
      ORDER BY created_at, id
    `);
  }

  const orderCols = columns.map(x => x.column_name);
  const allNewPresent = ['collection_branch_id','processing_branch_id','return_branch_id','current_branch_id']
    .every(x => orderCols.includes(x));

  let stats = null;
  let branchTypes = [];
  let crossTenant = null;
  let missingRefs = null;

  if (allNewPresent) {
    [stats] = await q(`
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE branch_id IS NOT NULL)::int AS legacy_branch_orders,
        COUNT(*) FILTER (
          WHERE collection_branch_id IS NOT NULL
            AND processing_branch_id IS NOT NULL
            AND return_branch_id IS NOT NULL
            AND current_branch_id IS NOT NULL
        )::int AS all_four_populated,
        COUNT(*) FILTER (
          WHERE collection_branch_id IS NULL
             OR processing_branch_id IS NULL
             OR return_branch_id IS NULL
             OR current_branch_id IS NULL
        )::int AS any_new_location_null,
        COUNT(*) FILTER (
          WHERE branch_id IS NULL
            AND collection_branch_id IS NULL
            AND processing_branch_id IS NULL
            AND return_branch_id IS NULL
            AND current_branch_id IS NULL
        )::int AS no_legacy_and_no_new_locations,
        COUNT(*) FILTER (
          WHERE branch_id IS NOT NULL AND collection_branch_id IS DISTINCT FROM branch_id
        )::int AS legacy_collection_mismatch,
        COUNT(*) FILTER (
          WHERE branch_id IS NOT NULL AND processing_branch_id IS DISTINCT FROM branch_id
        )::int AS legacy_processing_mismatch,
        COUNT(*) FILTER (
          WHERE branch_id IS NOT NULL AND return_branch_id IS DISTINCT FROM branch_id
        )::int AS legacy_return_mismatch,
        COUNT(*) FILTER (
          WHERE branch_id IS NOT NULL AND current_branch_id IS DISTINCT FROM branch_id
        )::int AS legacy_current_mismatch
      FROM public.orders
    `);

    [crossTenant] = await q(`
      SELECT COUNT(*)::int AS cross_tenant_location_orders
      FROM public.orders o
      WHERE EXISTS (
        SELECT 1
        FROM (VALUES
          (o.collection_branch_id),
          (o.processing_branch_id),
          (o.return_branch_id),
          (o.current_branch_id)
        ) v(branch_id)
        JOIN public.branches b ON b.id = v.branch_id
        WHERE v.branch_id IS NOT NULL
          AND b.laundry_id IS DISTINCT FROM o.laundry_id
      )
    `);

    [missingRefs] = await q(`
      SELECT COUNT(*)::int AS impossible_missing_branch_refs
      FROM public.orders o
      WHERE EXISTS (
        SELECT 1
        FROM (VALUES
          (o.collection_branch_id),
          (o.processing_branch_id),
          (o.return_branch_id),
          (o.current_branch_id)
        ) v(branch_id)
        LEFT JOIN public.branches b ON b.id = v.branch_id
        WHERE v.branch_id IS NOT NULL AND b.id IS NULL
      )
    `);

    branchTypes = await q(`
      SELECT type, COUNT(*)::int AS count
      FROM public.branches
      GROUP BY type
      ORDER BY type
    `);
  }

  console.log("[order-location-verification] READ-ONLY production verification");
  console.log(JSON.stringify({
    orders_columns: columns,
    drizzle_migrations: {
      exists: Boolean(migrationTable[0]?.exists),
      rows: migrations
    },
    four_new_columns_present: allNewPresent,
    order_stats: stats,
    branch_types: branchTypes,
    cross_tenant_location_orders: crossTenant?.cross_tenant_location_orders ?? null,
    impossible_missing_branch_refs: missingRefs?.impossible_missing_branch_refs ?? null
  }, null, 2));

  if (!allNewPresent) {
    console.log("[order-location-verification] New location columns are not yet in production. No data was changed.");
  } else {
    console.log("[order-location-verification] Verification complete. No data was changed.");
  }
} catch (err) {
  console.error("[order-location-verification] FAILED:", err?.message ?? String(err));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
