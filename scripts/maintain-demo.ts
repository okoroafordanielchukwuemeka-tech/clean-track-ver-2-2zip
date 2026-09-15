/**
 * CleanTrack Demo Activity Maintainer
 *
 * Keeps the demo workspace looking like a real laundry operating today.
 * Safe to run repeatedly (for example every 15 minutes from a scheduler).
 *
 * IMPORTANT:
 * - Only touches the laundry owned by demo@cleantrack.ng.
 * - Never deletes real tenant data.
 * - Creates ordinary orders/payments using the existing schema.
 * - Does not run automatically at application startup.
 */

import pg from "pg";

const { Client } = pg;

const DEMO_EMAIL = "demo@cleantrack.ng";
const MIN_TODAY_ORDERS = 18;
const MAX_TODAY_ORDERS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;

const FIRST_NAMES = [
  "Adaeze", "Chidi", "Emeka", "Ngozi", "Tunde", "Aisha", "Kunle",
  "Fatima", "Obinna", "Blessing", "Seun", "Chioma", "Amaka", "Yusuf",
  "Ifeoma", "Damilola", "Musa", "Chiamaka", "Ade", "Halima",
];
const LAST_NAMES = [
  "Okafor", "Adeyemi", "Musa", "Nwosu", "Abubakar", "Okonkwo", "Bello",
  "Eze", "Lawal", "Obi", "Usman", "Chukwu", "Nwachukwu", "Danjuma",
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function randomPhone(): string {
  return `080${rand(10000000, 99999999)}`;
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function randomTodayTime(): Date {
  // Keep new activity inside normal business hours while still spreading it
  // across the day. The timestamp is never in the future.
  const now = Date.now();
  const start = todayStart().getTime();
  const businessStart = start + 8 * 60 * 60 * 1000;
  const businessEnd = Math.min(now - 5 * 60 * 1000, start + 19 * 60 * 60 * 1000);

  if (businessEnd <= businessStart) return new Date(Math.max(start, now - 60 * 60 * 1000));
  return new Date(rand(businessStart, businessEnd));
}

function statusForAge(ageHours: number): "pending" | "processing" | "ready" | "completed" {
  if (ageHours < 1) return "pending";
  if (ageHours < 3) return "processing";
  if (ageHours < 7) return "ready";
  return "completed";
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");

    const laundryResult = await client.query(
      `SELECT id, business_name
       FROM laundries
       WHERE owner_email = $1
       LIMIT 1`,
      [DEMO_EMAIL],
    );

    if (laundryResult.rowCount === 0) {
      throw new Error(`Demo laundry ${DEMO_EMAIL} does not exist. Run pnpm seed-demo first.`);
    }

    const laundryId = laundryResult.rows[0].id as number;
    const businessName = laundryResult.rows[0].business_name as string;

    // 1. Load branches, customers and workers belonging only to the demo.
    const branchesResult = await client.query(
      `SELECT id, name FROM branches WHERE laundry_id = $1 ORDER BY id`,
      [laundryId],
    );
    const customersResult = await client.query(
      `SELECT id, full_name, phone, address, branch_id
       FROM customers
       WHERE laundry_id = $1
       ORDER BY id`,
      [laundryId],
    );
    const workersResult = await client.query(
      `SELECT id, name, branch_id
       FROM workers
       WHERE laundry_id = $1 AND is_active = true
       ORDER BY id`,
      [laundryId],
    );

    if (!branchesResult.rows.length || !customersResult.rows.length || !workersResult.rows.length) {
      throw new Error("Demo workspace is missing branches, customers, or workers. Run pnpm seed-demo:reset once to repair the demo dataset.");
    }

    // 2. Count today's demo orders. The script is idempotent: it only fills the gap.
    const todayResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM orders
       WHERE laundry_id = $1
         AND created_at >= CURRENT_DATE
         AND created_at < CURRENT_DATE + INTERVAL '1 day'`,
      [laundryId],
    );

    const todayCount = todayResult.rows[0].count as number;
    const targetCount = rand(MIN_TODAY_ORDERS, MAX_TODAY_ORDERS);
    const ordersToCreate = Math.max(0, targetCount - todayCount);

    // 3. Create enough orders to make TODAY look active.
    let createdOrders = 0;
    let createdPayments = 0;

    for (let i = 0; i < ordersToCreate; i++) {
      const branch = pick(branchesResult.rows);
      const branchCustomers = customersResult.rows.filter((c) => c.branch_id === branch.id);
      const branchWorkers = workersResult.rows.filter((w) => w.branch_id === branch.id);
      const customer = pick(branchCustomers.length ? branchCustomers : customersResult.rows);
      const worker = pick(branchWorkers.length ? branchWorkers : workersResult.rows);

      const createdAt = randomTodayTime();
      const ageHours = Math.max(0, (Date.now() - createdAt.getTime()) / (60 * 60 * 1000));
      const status = statusForAge(ageHours);

      const serviceType = pick(["standard", "standard", "express", "premium"]);
      const shirts = rand(1, 7);
      const trousers = rand(0, 4);
      const shirtPrice = serviceType === "express" ? 1200 : serviceType === "premium" ? 1500 : 800;
      const trouserPrice = serviceType === "express" ? 1500 : serviceType === "premium" ? 2000 : 1000;
      const price = shirts * shirtPrice + trousers * trouserPrice;

      const paymentStatus = status === "completed"
        ? "paid"
        : status === "ready" && Math.random() < 0.35
          ? "paid"
          : status === "processing" && Math.random() < 0.30
            ? "partial"
            : "unpaid";

      const amountPaid = paymentStatus === "paid"
        ? price
        : paymentStatus === "partial"
          ? Math.floor(price * rand(30, 70) / 100)
          : 0;

      const shirtsPickedUp = status === "completed" ? shirts : 0;
      const trousersPickedUp = status === "completed" ? trousers : 0;
      const orderId = `DEMO-LIVE-${createdAt.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${rand(100, 999)}`;

      const processingDueAt = new Date(createdAt.getTime() + (serviceType === "express" ? 6 : 24) * 60 * 60 * 1000);

      const orderResult = await client.query(
        `INSERT INTO orders (
           laundry_id, branch_id, customer_id, order_id,
           customer_name, phone, address, service_type,
           shirts, trousers, shirts_picked_up, trousers_picked_up,
           status, payment_status, price, amount_paid,
           is_verified, assigned_worker_id, processing_due_at,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12,
           $13, $14, $15, $16,
           true, $17, $18,
           $19, $19
         )
         RETURNING id`,
        [
          laundryId,
          branch.id,
          customer.id,
          orderId,
          customer.full_name,
          customer.phone,
          customer.address ?? null,
          serviceType,
          shirts,
          trousers,
          shirtsPickedUp,
          trousersPickedUp,
          status,
          paymentStatus,
          price.toString(),
          amountPaid.toString(),
          worker.id,
          processingDueAt,
          createdAt,
        ],
      );

      const orderDbId = orderResult.rows[0].id as number;
      createdOrders++;

      if (amountPaid > 0) {
        const receiptNumber = `RCT-${createdAt.toISOString().slice(0, 10).replace(/-/g, "")}-${String(orderDbId).padStart(4, "0")}`;
        await client.query(
          `INSERT INTO payment_records (
             order_id, laundry_id, branch_id, receipt_number,
             amount, method, remaining_balance,
             recorded_by, worker_id, recorded_at,
             reference, provider, reconciliation_status
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7,
             $8, $9, $10,
             $11, 'manual', 'confirmed'
           )`,
          [
            orderDbId,
            laundryId,
            branch.id,
            receiptNumber,
            amountPaid.toString(),
            pick(["cash", "transfer", "pos"]),
            Math.max(0, price - amountPaid).toString(),
            worker.name,
            worker.id,
            new Date(Math.min(Date.now(), createdAt.getTime() + rand(15, 90) * 60 * 1000)),
            orderId,
          ],
        );
        createdPayments++;
      }
    }

    // 4. Advance today's existing LIVE orders as time passes.
    // Only orders created by this maintainer are touched (order_id prefix).
    const liveOrders = await client.query(
      `SELECT id, created_at, status, payment_status, price, amount_paid, branch_id
       FROM orders
       WHERE laundry_id = $1
         AND order_id LIKE 'DEMO-LIVE-%'
         AND created_at >= CURRENT_DATE
       ORDER BY created_at`,
      [laundryId],
    );

    let advanced = 0;
    for (const order of liveOrders.rows) {
      const ageHours = Math.max(0, (Date.now() - new Date(order.created_at).getTime()) / (60 * 60 * 1000));
      const desiredStatus = statusForAge(ageHours);

      if (order.status !== desiredStatus) {
        const desiredPaymentStatus = desiredStatus === "completed"
          ? "paid"
          : desiredStatus === "ready" && Math.random() < 0.5
            ? "paid"
            : order.payment_status;

        const price = Number(order.price ?? 0);
        const desiredAmountPaid = desiredPaymentStatus === "paid"
          ? price
          : Number(order.amount_paid ?? 0);

        await client.query(
          `UPDATE orders
           SET status = $1,
               payment_status = $2,
               amount_paid = $3,
               updated_at = NOW()
           WHERE id = $4 AND laundry_id = $5`,
          [desiredStatus, desiredPaymentStatus, desiredAmountPaid.toString(), order.id, laundryId],
        );
        advanced++;
      }
    }

    await client.query("COMMIT");

    console.log(`[demo-live] ${businessName}`);
    console.log(`[demo-live] Existing orders today: ${todayCount}`);
    console.log(`[demo-live] Target orders today: ${targetCount}`);
    console.log(`[demo-live] Created: ${createdOrders} orders, ${createdPayments} payments`);
    console.log(`[demo-live] Advanced: ${advanced} live orders`);
    console.log(`[demo-live] Demo workspace only: ${DEMO_EMAIL}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[demo-live] Failed:", error);
  process.exit(1);
});
