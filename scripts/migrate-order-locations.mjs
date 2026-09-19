import pg from "pg";

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

const REQUIRED = [
  "collection_branch_id",
  "processing_branch_id",
  "return_branch_id",
  "current_branch_id",
];

const q = (sql, params = []) => client.query(sql, params);

try {
  await client.connect();
  await q("BEGIN");

  // Lock the orders table so the additive schema change and backfill are atomic.
  await q("LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE");

  const existing = await q(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = ANY($1::text[])
  `, [REQUIRED]);

  const have = new Set(existing.rows.map(r => r.column_name));

  for (const column of REQUIRED) {
    if (!have.has(column)) {
      await q(`
        ALTER TABLE public.orders
        ADD COLUMN ${column} integer
        REFERENCES public.branches(id)
        ON DELETE SET NULL
      `);
    }
  }

  await q(`
    UPDATE public.orders
    SET
      collection_branch_id = COALESCE(collection_branch_id, branch_id),
      processing_branch_id = COALESCE(processing_branch_id, branch_id),
      return_branch_id = COALESCE(return_branch_id, branch_id),
      current_branch_id = COALESCE(current_branch_id, branch_id)
    WHERE branch_id IS NOT NULL
      AND (
        collection_branch_id IS NULL
        OR processing_branch_id IS NULL
        OR return_branch_id IS NULL
        OR current_branch_id IS NULL
      )
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS orders_collection_branch_id_idx
      ON public.orders (collection_branch_id)
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS orders_processing_branch_id_idx
      ON public.orders (processing_branch_id)
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS orders_return_branch_id_idx
      ON public.orders (return_branch_id)
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS orders_current_branch_id_idx
      ON public.orders (current_branch_id)
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS orders_laundry_collection_branch_idx
      ON public.orders (laundry_id, collection_branch_id)
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS orders_laundry_processing_branch_idx
      ON public.orders (laundry_id, processing_branch_id)
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS orders_laundry_return_branch_idx
      ON public.orders (laundry_id, return_branch_id)
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS orders_laundry_current_branch_idx
      ON public.orders (laundry_id, current_branch_id)
  `);

  const verify = await q(`
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
      )::int AS any_location_null,
      COUNT(*) FILTER (
        WHERE branch_id IS NOT NULL
          AND (
            collection_branch_id IS DISTINCT FROM branch_id
            OR processing_branch_id IS DISTINCT FROM branch_id
            OR return_branch_id IS DISTINCT FROM branch_id
            OR current_branch_id IS DISTINCT FROM branch_id
          )
      )::int AS legacy_backfill_mismatches,
      COUNT(*) FILTER (
        WHERE branch_id IS NULL
          AND collection_branch_id IS NULL
          AND processing_branch_id IS NULL
          AND return_branch_id IS NULL
          AND current_branch_id IS NULL
      )::int AS no_legacy_and_no_new_locations,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM (VALUES
            (collection_branch_id),
            (processing_branch_id),
            (return_branch_id),
            (current_branch_id)
          ) v(branch_id)
          JOIN public.branches b ON b.id = v.branch_id
          WHERE v.branch_id IS NOT NULL
            AND b.laundry_id IS DISTINCT FROM public.orders.laundry_id
        )
      )::int AS cross_tenant_location_orders
    FROM public.orders
  `);

  const bad = verify.rows[0];
  if (
    Number(bad.legacy_backfill_mismatches) !== 0 ||
    Number(bad.cross_tenant_location_orders) !== 0
  ) {
    throw new Error("Post-migration integrity verification failed");
  }

  await q("COMMIT");

  console.log("[order-location-migration] SUCCESS");
  console.log(JSON.stringify({
    added_columns: REQUIRED.filter(x => !have.has(x)),
    verification: bad
  }, null, 2));
} catch (err) {
  await q("ROLLBACK").catch(() => {});
  console.error("[order-location-migration] ROLLED BACK:", err?.message ?? String(err));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
