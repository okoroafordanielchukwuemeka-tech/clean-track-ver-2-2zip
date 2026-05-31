/**
 * Phase 4 Validation Seed Script
 * Creates 2 branches, 10 customers/branch, 30 orders/branch with payments
 * Run: npx tsx scripts/seed-branches.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../lib/db/src/schema/index.js";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const {
  laundries, branches, customers, orders, paymentRecords,
  workers, workerPermissions, services, WORKER_DEFAULT_PERMISSIONS,
} = schema;

function rnd(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randEl<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const serviceTypeList = ["standard", "express", "premium"] as const;
const paymentMethods = ["cash", "transfer", "pos"] as const;

const customerNames = [
  "Emeka Okafor", "Fatima Bello", "Chidi Nwosu", "Aisha Musa", "Kunle Adeyemi",
  "Ngozi Eze", "Bola Fashola", "Tunde Bakare", "Amaka Obi", "Yusuf Lawan",
  "Sola Adegoke", "Mercy Ibe", "Danladi Garba", "Chiamaka Nkemdirim", "Ibrahim Danjuma",
  "Bunmi Ogundele", "Hakeem Lawal", "Patricia Ezeala", "Ayo Coker", "Zainab Yusuf",
];

async function ensureLaundry() {
  const [existing] = await db.select().from(laundries).limit(1);
  if (existing) return existing;

  const hash = await bcrypt.hash("Password1!", 10);
  const [created] = await db.insert(laundries).values({
    businessName: "Demo Laundry Co.",
    ownerEmail: "demo@cleantrack.test",
    passwordHash: hash,
    phone: "08012345678",
    isActive: true,
    subscriptionTier: "pro",
  }).returning();
  console.log(`✓ Created test laundry: "${created.businessName}" (email: demo@cleantrack.test, password: Password1!)`);
  return created;
}

async function ensureService(laundryId: number) {
  const [existing] = await db.select().from(services).where(
    and(eq(services.laundryId, laundryId), eq(services.isActive, true))
  ).limit(1);
  if (existing) return existing;

  const [svc] = await db.insert(services).values({
    laundryId,
    name: "Shirt Wash & Iron",
    category: "Wash & Iron",
    standardPrice: "1500",
    expressPrice: "2500",
    premiumPrice: "3500",
    isActive: true,
  }).returning();
  console.log(`✓ Created service: "${svc.name}"`);
  return svc;
}

async function ensureBranch(laundryId: number, name: string, address: string) {
  const [existing] = await db.select().from(branches).where(
    and(eq(branches.laundryId, laundryId), eq(branches.name, name))
  ).limit(1);
  if (existing) {
    console.log(`  ↩ Branch exists: "${name}" (ID: ${existing.id})`);
    return existing;
  }
  const [created] = await db.insert(branches).values({ laundryId, name, address }).returning();
  console.log(`✓ Created branch: "${name}" (ID: ${created.id})`);
  return created;
}

let receiptCounter = 0;
const RECEIPT_DATE = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const RECEIPT_PREFIX = `RCT-${RECEIPT_DATE}-`;

async function initReceiptCounter() {
  // Get all receipt numbers with today's prefix, parse the suffix manually
  const rows = await db
    .select({ num: paymentRecords.receiptNumber })
    .from(paymentRecords)
    .where(drizzleSql`receipt_number LIKE ${RECEIPT_PREFIX + "%"}`);
  let max = 0;
  for (const r of rows) {
    if (!r.num) continue;
    const suffix = r.num.slice(RECEIPT_PREFIX.length);
    const n = parseInt(suffix, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  receiptCounter = max;
}

function getNextReceiptNumber(): string {
  receiptCounter++;
  return `${RECEIPT_PREFIX}${receiptCounter.toString().padStart(4, "0")}`;
}

async function seedBranch(
  laundryId: number,
  branch: typeof branches.$inferSelect,
  branchCustomers: typeof customers.$inferSelect[],
) {
  const TARGET_ORDERS = 30;
  const existing = await db.select({ id: orders.id }).from(orders).where(
    and(eq(orders.laundryId, laundryId), eq(orders.branchId, branch.id))
  );
  const needed = TARGET_ORDERS - existing.length;
  if (needed <= 0) {
    console.log(`  ↩ Branch "${branch.name}" already has ${existing.length} orders, skipping order creation.`);
    return { ordersCreated: 0, paymentsRecorded: 0, totalRevenue: 0 };
  }

  let ordersCreated = 0, paymentsRecorded = 0, totalRevenue = 0;

  for (let i = 0; i < needed; i++) {
    const customer = randEl(branchCustomers);
    const svcType = randEl(serviceTypeList);
    const price = rnd(2000, 20000);
    const shirts = rnd(1, 10);
    const trousers = rnd(0, 6);

    // Unique orderId
    const orderId = `B${branch.id}-${Date.now().toString(36).toUpperCase()}-${i.toString().padStart(3, "0")}`;
    const createdAt = new Date(Date.now() - rnd(0, 25) * 86400000);
    const hoursMap = { standard: 72, express: 24, premium: 48 };
    const processingDueAt = new Date(createdAt.getTime() + hoursMap[svcType] * 3600000);

    // Determine status and payment
    const statusOptions = ["pending", "processing", "ready", "completed"] as const;
    const statusWeights = [15, 25, 30, 30];
    let roll = rnd(0, 99);
    let statusIdx = 0;
    for (let wi = 0; wi < statusWeights.length; wi++) {
      if (roll < statusWeights[wi]) { statusIdx = wi; break; }
      roll -= statusWeights[wi];
    }
    const status = statusOptions[statusIdx];
    const isReady = ["ready", "completed"].includes(status);

    const payRoll = rnd(0, 2);
    const amountPaid = payRoll === 2 ? price : payRoll === 1 ? Math.floor(price * 0.5) : 0;
    const paymentStatus = amountPaid >= price ? "paid" : amountPaid > 0 ? "partial" : "unpaid";

    const [order] = await db.insert(orders).values({
      laundryId,
      branchId: branch.id,
      customerId: customer.id,
      orderId,
      customerName: customer.fullName,
      phone: customer.phone,
      serviceType: svcType,
      shirts,
      trousers,
      price: price.toString(),
      amountPaid: amountPaid.toString(),
      status,
      paymentStatus,
      isVerified: isReady,
      verifiedShirts: isReady ? shirts : null,
      verifiedTrousers: isReady ? trousers : null,
      shirtsPickedUp: status === "completed" ? shirts : 0,
      trousersPickedUp: status === "completed" ? trousers : 0,
      processingDueAt,
      createdAt,
      updatedAt: new Date(),
    }).returning();

    ordersCreated++;
    totalRevenue += price;

    // Record payment
    if (amountPaid > 0) {
      const receiptNumber = getNextReceiptNumber();
      await db.insert(paymentRecords).values({
        orderId: order.id,
        laundryId,
        branchId: branch.id,
        receiptNumber,
        amount: amountPaid.toString(),
        method: randEl(paymentMethods),
        remainingBalance: Math.max(0, price - amountPaid).toString(),
        recordedBy: "Seed Script",
        recordedAt: createdAt,
      });
      paymentsRecorded++;
    }
  }
  return { ordersCreated, paymentsRecorded, totalRevenue };
}

async function main() {
  console.log("\n=== Phase 4: Multi-Branch Seed & Validation ===\n");

  // 1. Laundry
  const laundry = await ensureLaundry();
  console.log(`✓ Laundry: "${laundry.businessName}" (ID: ${laundry.id})`);

  // 2. Service
  await ensureService(laundry.id);

  // 3. Branches
  console.log("\n--- Branches ---");
  const branch1 = await ensureBranch(laundry.id, "Main Branch", "12 Allen Avenue, Lagos Island");
  const branch2 = await ensureBranch(laundry.id, "Ikeja Branch", "45 Obafemi Awolowo Way, Ikeja");
  const branchList = [branch1, branch2];

  // 4. Customers (10 per branch)
  console.log("\n--- Customers ---");
  const branchCustomers: Record<number, typeof customers.$inferSelect[]> = {};
  for (const branch of branchList) {
    const existing = await db.select().from(customers).where(
      and(eq(customers.laundryId, laundry.id), eq(customers.branchId, branch.id))
    );
    const custs = [...existing];
    for (let i = custs.length; i < 10; i++) {
      const idx = (branch.id === branch1.id ? 0 : 10) + i;
      const [c] = await db.insert(customers).values({
        laundryId: laundry.id,
        branchId: branch.id,
        fullName: `${customerNames[idx % customerNames.length]}`,
        phone: `0${(800000000 + branch.id * 100 + i).toString()}`,
        address: `${rnd(1, 100)} Test Street, Lagos`,
      }).returning();
      custs.push(c);
    }
    branchCustomers[branch.id] = custs;
    console.log(`✓ Branch "${branch.name}": ${custs.length} customers`);
  }

  // 5. Orders + Payments
  console.log("\n--- Orders & Payments ---");
  await initReceiptCounter();
  const branchStats: Record<string, ReturnType<typeof seedBranch> extends Promise<infer T> ? T : never> = {};
  for (const branch of branchList) {
    const stats = await seedBranch(laundry.id, branch, branchCustomers[branch.id]);
    branchStats[branch.name] = stats;
    console.log(`✓ Branch "${branch.name}": +${stats.ordersCreated} orders, +${stats.paymentsRecorded} payments`);
  }

  // 6. Branch workers
  console.log("\n--- Branch Workers ---");
  for (const branch of branchList) {
    const workerName = `${branch.name} Staff`;
    const [existing] = await db.select().from(workers).where(
      and(eq(workers.laundryId, laundry.id), eq(workers.branchId, branch.id))
    ).limit(1);
    if (!existing) {
      const pin = await bcrypt.hash("1234", 10);
      const [worker] = await db.insert(workers).values({
        laundryId: laundry.id,
        branchId: branch.id,
        name: workerName,
        phone: `0${(700000000 + branch.id).toString()}`,
        role: "worker",
        pin,
        isActive: true,
      }).returning();
      await db.insert(workerPermissions).values({
        workerId: worker.id,
        laundryId: laundry.id,
        ...WORKER_DEFAULT_PERMISSIONS,
      });
      console.log(`✓ Created worker "${workerName}" (phone: ${worker.phone}, PIN: 1234)`);
    } else {
      console.log(`  ↩ Worker exists for "${branch.name}": "${existing.name}"`);
    }
  }

  // =========================================================
  // VALIDATION REPORT
  // =========================================================
  console.log("\n==========================================");
  console.log("      PHASE 4 VALIDATION REPORT");
  console.log("==========================================\n");

  let allPass = true;

  // Branch isolation
  console.log("📋 BRANCH ISOLATION");
  for (const branch of branchList) {
    const branchOrders = await db.select().from(orders).where(
      and(eq(orders.laundryId, laundry.id), eq(orders.branchId, branch.id))
    );
    const branchCusts = await db.select().from(customers).where(
      and(eq(customers.laundryId, laundry.id), eq(customers.branchId, branch.id))
    );
    const crossLeaks = branchOrders.filter(o => o.branchId !== branch.id).length;
    const pass = crossLeaks === 0 && branchOrders.length >= 30 && branchCusts.length >= 10;
    if (!pass) allPass = false;

    const paid = branchOrders.reduce((acc, o) => acc + parseFloat(o.amountPaid ?? "0"), 0);
    const total = branchOrders.reduce((acc, o) => acc + parseFloat(o.price ?? "0"), 0);

    console.log(`\n  Branch: "${branch.name}" (ID: ${branch.id})`);
    console.log(`    Orders:       ${branchOrders.length} ${branchOrders.length >= 30 ? "✅" : "❌"}`);
    console.log(`    Customers:    ${branchCusts.length} ${branchCusts.length >= 10 ? "✅" : "❌"}`);
    console.log(`    Cross-leaks:  ${crossLeaks} ${crossLeaks === 0 ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`    Revenue:      ₦${total.toLocaleString()}`);
    console.log(`    Collected:    ₦${paid.toLocaleString()} (${total > 0 ? ((paid / total) * 100).toFixed(1) : 0}%)`);
  }

  // Receipt uniqueness
  console.log("\n\n🧾 RECEIPT UNIQUENESS");
  const allReceipts = await db.select().from(paymentRecords).where(
    eq(paymentRecords.laundryId, laundry.id)
  );
  const receiptNums = allReceipts.map(r => r.receiptNumber).filter(Boolean);
  const uniqueCount = new Set(receiptNums).size;
  const hasNoDups = receiptNums.length === uniqueCount;
  if (!hasNoDups) allPass = false;
  const branchScoped = allReceipts.filter(r => r.branchId !== null).length;
  console.log(`  Total records:  ${allReceipts.length}`);
  console.log(`  Unique numbers: ${uniqueCount} ${hasNoDups ? "✅ NO DUPLICATES" : "❌ DUPLICATES FOUND"}`);
  console.log(`  Branch-scoped:  ${branchScoped}/${allReceipts.length} ✅`);
  const sample = allReceipts.slice(-3);
  console.log(`  Recent receipts:`);
  for (const r of sample) {
    console.log(`    ${r.receiptNumber} | ₦${parseFloat(r.amount).toLocaleString()} | Branch: ${r.branchId} | ${r.method}`);
  }

  // Worker branch scoping
  console.log("\n\n👷 WORKER BRANCH SCOPING");
  const allWorkers = await db.select().from(workers).where(eq(workers.laundryId, laundry.id));
  const branchWorkers = allWorkers.filter(w => w.branchId !== null);
  console.log(`  Total workers:        ${allWorkers.length}`);
  console.log(`  Branch-scoped workers: ${branchWorkers.length} ✅`);

  // Order status distribution
  console.log("\n\n📊 ORDER STATUS DISTRIBUTION");
  const allOrders = await db.select().from(orders).where(eq(orders.laundryId, laundry.id));
  const statusMap: Record<string, number> = {};
  for (const o of allOrders) {
    statusMap[o.status] = (statusMap[o.status] ?? 0) + 1;
  }
  for (const [s, count] of Object.entries(statusMap)) {
    console.log(`  ${s.padEnd(12)}: ${count} orders`);
  }

  // Summary
  console.log("\n\n==========================================");
  if (allPass) {
    console.log("✅ ALL CHECKS PASSED — System is multi-branch ready.");
  } else {
    console.log("❌ SOME CHECKS FAILED — Review above output.");
  }
  console.log("==========================================\n");

  await pool.end();
}

main().catch(err => {
  console.error("Seed error:", err);
  process.exit(1);
});
