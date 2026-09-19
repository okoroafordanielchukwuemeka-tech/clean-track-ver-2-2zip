import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE");

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.order_movements (
      id serial PRIMARY KEY,
      laundry_id integer NOT NULL REFERENCES public.laundries(id) ON DELETE CASCADE,
      order_id integer NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
      from_branch_id integer REFERENCES public.branches(id) ON DELETE SET NULL,
      to_branch_id integer NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
      movement_type text NOT NULL CHECK (movement_type IN ('COLLECTION','PROCESSING_TRANSFER','RETURN_TRANSFER','MANUAL_TRANSFER')),
      reason text,
      moved_by_worker_id integer REFERENCES public.workers(id) ON DELETE SET NULL,
      moved_by_type text,
      moved_by_name text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await client.query("CREATE INDEX IF NOT EXISTS order_movements_order_idx ON public.order_movements (order_id, created_at)");
  await client.query("CREATE INDEX IF NOT EXISTS order_movements_laundry_idx ON public.order_movements (laundry_id, created_at)");
  await client.query("CREATE INDEX IF NOT EXISTS order_movements_to_branch_idx ON public.order_movements (to_branch_id, created_at)");

  const check = await client.query(`
    SELECT
      to_regclass('public.order_movements') IS NOT NULL AS table_exists,
      COUNT(*)::int AS movement_rows
    FROM public.order_movements
  `);
  if (!check.rows[0]?.table_exists) throw new Error("order_movements table verification failed");

  await client.query("COMMIT");
  console.log("[order-movements-migration] SUCCESS", JSON.stringify(check.rows[0]));
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("[order-movements-migration] ROLLED BACK:", err?.message ?? String(err));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
