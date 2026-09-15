/**
 * Refresh the existing CleanTrack demo timeline without recreating data.
 *
 * Safety:
 * - Targets only the laundry whose ownerEmail is demo@cleantrack.ng.
 * - Moves the whole demo timeline by one shared offset, preserving the
 *   relationship between order age, payment age, expense age, etc.
 * - If the newest demo order is already within the last 24 hours, it does
 *   nothing. This makes the command safe to run repeatedly.
 */
import pg from "pg";

const { Client } = pg;
const DEMO_EMAIL = "demo@cleantrack.ng";
const DAY_MS = 24 * 60 * 60 * 1000;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT MAX(o.created_at) AS max_created
       FROM orders o
       JOIN laundries l ON l.id = o.laundry_id
       WHERE l.owner_email = $1`,
      [DEMO_EMAIL],
    );

    const maxCreated = result.rows[0]?.max_created as Date | null;
    if (!maxCreated) {
      console.log("[demo-refresh] No demo orders found; nothing to refresh.");
      await client.query("COMMIT");
      return;
    }

    const shiftMs = Date.now() - new Date(maxCreated).getTime();
    if (shiftMs < DAY_MS) {
      console.log("[demo-refresh] Demo timeline is already current; no changes made.");
      await client.query("COMMIT");
      return;
    }

    const tables: Array<[string, string[]]> = [
      ["orders", ["created_at", "updated_at"]],
      ["payment_records", ["recorded_at", "deleted_at", "refunded_at"]],
      ["expenditures", ["created_at", "updated_at"]],
      ["discount_approvals", ["created_at", "resolved_at"]],
      ["batches", ["created_at"]],
    ];

    for (const [table, columns] of tables) {
      for (const column of columns) {
        await client.query(
          `UPDATE ${table} t
           SET ${column} = ${column} + ($1 * INTERVAL '1 millisecond')
           FROM laundries l
           WHERE t.laundry_id = l.id
             AND l.owner_email = $2
             AND ${column} IS NOT NULL`,
          [shiftMs, DEMO_EMAIL],
        );
      }
    }

    await client.query("COMMIT");
    console.log(`[demo-refresh] Shifted demo timeline forward by ${Math.round(shiftMs / DAY_MS)} day(s).`);
    console.log("[demo-refresh] Only demo@cleantrack.ng was modified.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[demo-refresh] Failed:", error);
  process.exit(1);
});
