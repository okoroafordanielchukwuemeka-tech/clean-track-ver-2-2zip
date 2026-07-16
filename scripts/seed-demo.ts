/**
 * CleanTrack Demo Seeder
 * Creates a fully populated demo environment:
 *   1 Demo Owner + 5 branches + 20 workers + 200 customers + 1000 orders
 *   Payments, discount requests, approvals, and expenditures per branch
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import bcrypt from "bcryptjs";
import * as schema from "../lib/db/src/schema/index.js";
import { eq, and, inArray, sql } from "drizzle-orm";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const {
  laundries, branches, workers, customers, orders,
  paymentRecords, priceAdjustments, discountApprovals, services,
  expenditures, expenseCategories, messageTemplates,
  conversations, conversationMessages,
  notifications, notificationEvents, activationEvents,
  batches,
} = schema;

const RESET_MODE = process.argv.includes("--reset");

// ── helpers ────────────────────────────────────────────────────────────────
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}
let _oidCounter = 1;
function nextOrderId(): string {
  const pad = String(_oidCounter++).padStart(4, "0");
  return `DEMO${pad}`;
}
let _receiptCounter = 1;
function nextReceipt(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const pad = String(_receiptCounter++).padStart(4, "0");
  return `RCT-${date}-${pad}`;
}

const FIRST_NAMES = [
  "Adaeze","Chidi","Emeka","Ngozi","Tunde","Aisha","Kunle","Fatima",
  "Obinna","Blessing","Seun","Chioma","Babajide","Amaka","Yusuf",
  "Ifeoma","Damilola","Musa","Chiamaka","Ade","Halima","Olu","Nkechi",
  "Ibrahim","Tobi","Zainab","Gbenga","Ada","Sule","Nneka",
];
const LAST_NAMES = [
  "Okafor","Adeyemi","Musa","Nwosu","Abubakar","Okonkwo","Bello",
  "Eze","Lawal","Obi","Usman","Chukwu","Babatunde","Nwachukwu","Danjuma",
  "Ogundele","Isa","Obiora","Alabi","Yusuf",
];
function randomName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}
function randomPhone() {
  return `080${rand(10000000, 99999999)}`;
}

const BRANCH_NAMES = [
  "Lagos Island",
  "Ikeja",
  "Victoria Island",
  "Lekki",
  "Surulere",
];

const BRANCH_ADDRESSES = [
  "14 Broad Street, Lagos Island",
  "22 Allen Avenue, Ikeja",
  "5 Adeola Odeku Street, Victoria Island",
  "Plot 12, Admiralty Way, Lekki Phase 1",
  "88 Bode Thomas Street, Surulere",
];

const SERVICE_CATALOG = [
  { name: "Shirts (Wash & Iron)",   category: "clothing",    imageUrl: "icon:shirt",    standardPrice: "800",  expressPrice: "1200", premiumPrice: "1500"  },
  { name: "Trousers (Wash & Iron)", category: "clothing",    imageUrl: "icon:pants",    standardPrice: "1000", expressPrice: "1500", premiumPrice: "2000"  },
  { name: "Suits (Full Dry Clean)", category: "formal",      imageUrl: "icon:suit",     standardPrice: "4000", expressPrice: "6000", premiumPrice: "8000"  },
  { name: "Dresses",                category: "clothing",    imageUrl: "icon:dress",    standardPrice: "1500", expressPrice: "2200", premiumPrice: "3000"  },
  { name: "Bedsheets (Single)",     category: "bedding",     imageUrl: "icon:bedsheet", standardPrice: "1200", expressPrice: "1800", premiumPrice: "2500"  },
  { name: "Duvet / Comforter",      category: "bedding",     imageUrl: "icon:duvet",    standardPrice: "3500", expressPrice: "5000", premiumPrice: "7000"  },
  { name: "Agbada (Full Set)",      category: "traditional", imageUrl: "icon:agbada",   standardPrice: "5000", expressPrice: "7500", premiumPrice: "10000" },
  { name: "Ankara Fabric (Piece)",  category: "traditional", imageUrl: "icon:ankara",   standardPrice: "1800", expressPrice: "2500", premiumPrice: "3500"  },
  { name: "Sneakers (Pair)",        category: "footwear",    imageUrl: "icon:sneaker",  standardPrice: "2500", expressPrice: "3500", premiumPrice: "5000"  },
  { name: "Leather Shoes (Pair)",   category: "footwear",    imageUrl: "icon:shoe",     standardPrice: "2000", expressPrice: "3000", premiumPrice: "4500"  },
];

const EXPENSE_NAMES = ["electricity","detergent","water","salaries","transport","maintenance","packaging","miscellaneous"];

const DEFAULT_CATEGORIES = [
  "electricity","detergent","water","salaries","transport","maintenance","packaging","miscellaneous",
];

const DEFAULT_TEMPLATES = [
  {
    name: "Order Ready",
    subject: "Your laundry is ready!",
    body: "Hi {{customerName}}, your order #{{orderId}} is ready for pickup. Thank you for choosing {{businessName}}!",
  },
  {
    name: "Payment Reminder",
    subject: "Payment reminder",
    body: "Hi {{customerName}}, you have an outstanding balance of ₦{{balance}} for order #{{orderId}}. Please settle at your earliest convenience.",
  },
];

// ── reset ──────────────────────────────────────────────────────────────────
async function resetDemoData() {
  const DEMO_EMAIL = "demo@cleantrack.ng";
  const [existing] = await db.select().from(laundries).where(eq(laundries.ownerEmail, DEMO_EMAIL));
  if (!existing) {
    console.log("ℹ️  No demo data found — nothing to reset.");
    return;
  }
  const laundryId = existing.id;
  console.log(`🗑️  Resetting demo data for laundryId=${laundryId}...`);

  // Delete in dependency order (children before parents)
  await db.execute(sql`DELETE FROM conversation_messages WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM conversations WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM notification_events WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM notifications WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM discount_approvals WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM price_adjustments WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM payment_records WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM pickup_records WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM orders WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM expenditures WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM customers WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM workers WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM service_branches WHERE service_id IN (SELECT id FROM services WHERE laundry_id = ${laundryId})`);
  await db.execute(sql`DELETE FROM services WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM branches WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM expense_categories WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM message_templates WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM activation_events WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM batches WHERE laundry_id = ${laundryId}`);
  await db.execute(sql`DELETE FROM laundries WHERE id = ${laundryId}`);

  console.log("✅ Demo data cleared.\n");
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  if (RESET_MODE) {
    console.log("🔄 RESET MODE — wiping all demo data before re-seeding...\n");
    await resetDemoData();
  }
  console.log("🚀 Starting demo seed...\n");

  // ── 1. Create or reuse demo laundry ──────────────────────────────────────
  const DEMO_EMAIL = "demo@cleantrack.ng";
  const DEMO_PASS = "Demo@1234";
  const passwordHash = await bcrypt.hash(DEMO_PASS, 12);

  let laundry: typeof laundries.$inferSelect;
  const [existing] = await db.select().from(laundries).where(eq(laundries.ownerEmail, DEMO_EMAIL));

  if (existing) {
    console.log("ℹ️  Demo laundry already exists — reusing it.");
    laundry = existing;
  } else {
    [laundry] = await db.insert(laundries).values({
      businessName: "CleanTrack Demo Laundry",
      ownerEmail: DEMO_EMAIL,
      passwordHash,
      phone: "08012345678",
      discountSettings: {
        autoApprovalThreshold: 500,
        maxDiscountPerOrder: 5000,
        maxDiscountPercentage: 20,
      },
      businessProfile: {
        address: "1 Demo Close, Lagos",
        email: DEMO_EMAIL,
      },
      brandingSettings: {
        receiptHeaderName: "CleanTrack Demo",
        receiptFooterText: "Thank you for your business!",
      },
    }).returning();
    console.log(`✅ Created demo laundry: ${laundry.businessName}`);

    // Seed default expense categories & message templates
    await db.insert(expenseCategories).values(
      DEFAULT_CATEGORIES.map(name => ({ laundryId: laundry.id, name, isDefault: true, isActive: true }))
    ).onConflictDoNothing();
    await db.insert(messageTemplates).values(
      DEFAULT_TEMPLATES.map(t => ({
        laundryId: laundry.id,
        name: t.name,
        subject: t.subject,
        body: t.body,
        isDefault: true,
        isActive: true,
      }))
    ).onConflictDoNothing();
  }

  const laundryId = laundry.id;

  // Ensure demo account always has an active pro subscription (never expires)
  // and correct discount settings, regardless of whether it was freshly created.
  const tenYearsFromNow = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  await db.update(laundries).set({
    subscriptionStatus: "active",
    subscriptionTier: "business",
    subscriptionRenewsAt: tenYearsFromNow,
    trialStartedAt: null,
    trialEndsAt: null,
    discountSettings: {
      autoApprovalThreshold: 500,
      maxDiscountPerOrder: 5000,
      maxDiscountPercentage: 20,
    },
  }).where(eq(laundries.id, laundryId));

  // ── 2. Services catalog ──────────────────────────────────────────────────
  const existingServices = await db.select().from(services).where(eq(services.laundryId, laundryId));
  let serviceList = existingServices;
  if (existingServices.length === 0) {
    serviceList = await db.insert(services).values(
      SERVICE_CATALOG.map(s => ({ laundryId, ...s, isActive: true }))
    ).returning();
    console.log(`✅ Created ${serviceList.length} services`);
  } else {
    console.log(`ℹ️  Reusing ${serviceList.length} existing services`);
  }

  // ── 3. Branches ──────────────────────────────────────────────────────────
  let branchList: typeof branches.$inferSelect[] = await db.select().from(branches).where(eq(branches.laundryId, laundryId));
  if (branchList.length < 5) {
    const toCreate = BRANCH_NAMES.slice(branchList.length);
    const newBranches = await db.insert(branches).values(
      toCreate.map((name, i) => ({
        laundryId,
        name,
        address: BRANCH_ADDRESSES[branchList.length + i],
      }))
    ).returning();
    branchList = [...branchList, ...newBranches];
    console.log(`✅ Created ${newBranches.length} branches (total: ${branchList.length})`);
  } else {
    console.log(`ℹ️  Reusing ${branchList.length} existing branches`);
  }

  // ── 4. Workers (4 per branch = 20 total) ─────────────────────────────────
  const WORKER_PINS = ["1234","5678","2222","3333","4444","5555","6666","7777","8888","9999",
                       "1111","2468","1357","9876","5432","1122","3344","5566","7788","9900"];
  let workerList: typeof workers.$inferSelect[] = await db.select().from(workers).where(eq(workers.laundryId, laundryId));
  const workersCreated: typeof workers.$inferSelect[] = [];
  const workerCredentials: { branch: string; name: string; phone: string; pin: string }[] = [];

  if (workerList.length < 20) {
    let wIdx = workerList.length;
    for (let b = 0; b < branchList.length; b++) {
      const branch = branchList[b];
      const existingInBranch = workerList.filter(w => w.branchId === branch.id);
      const needed = 4 - existingInBranch.length;
      for (let i = 0; i < needed; i++) {
        const plainPin = WORKER_PINS[wIdx % WORKER_PINS.length];
        // Hash PIN using the same bcrypt workflow as production (workers.ts POST /)
        const pinHash = await bcrypt.hash(plainPin, 12);
        const pinChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
        const name = randomName();
        const phone = randomPhone();
        const [w] = await db.insert(workers).values({
          laundryId,
          branchId: branch.id,
          name,
          phone,
          pin: pinHash,           // bcrypt hash — identical to production
          pinChangedAt,           // required for token invalidation check
          role: i === 0 ? "admin" : "worker",
          isActive: true,
        }).returning();
        workersCreated.push(w);
        workerCredentials.push({ branch: branch.name, name, phone, pin: plainPin });
        wIdx++;
      }
    }
    workerList = [...workerList, ...workersCreated];
    console.log(`✅ Created ${workersCreated.length} workers with bcrypt-hashed PINs (total: ${workerList.length})`);
  } else {
    console.log(`ℹ️  Reusing ${workerList.length} existing workers`);
    // We cannot recover plain PINs from bcrypt hashes — show known PIN list for demo workers.
    // WORKER_PINS[index % length] matches the insertion order used above.
    let wIdx = 0;
    for (const branch of branchList) {
      const branchWorkers = workerList.filter(w => w.branchId === branch.id);
      for (const w of branchWorkers) {
        const knownPin = WORKER_PINS[wIdx % WORKER_PINS.length];
        if (w.phone) {
          workerCredentials.push({ branch: branch.name, name: w.name, phone: w.phone, pin: knownPin });
        }
        wIdx++;
      }
    }
  }

  // ── 5. Customers (40 per branch = 200 total) ─────────────────────────────
  let customerList: typeof customers.$inferSelect[] = await db.select().from(customers).where(eq(customers.laundryId, laundryId));
  const customersByBranch: Record<number, typeof customers.$inferSelect[]> = {};

  if (customerList.length < 200) {
    console.log("Creating customers...");
    for (const branch of branchList) {
      customersByBranch[branch.id] = customerList.filter(c => c.branchId === branch.id);
      const needed = 40 - customersByBranch[branch.id].length;
      for (let i = 0; i < needed; i++) {
        const [c] = await db.insert(customers).values({
          laundryId,
          branchId: branch.id,
          fullName: randomName(),
          phone: randomPhone(),
          address: `${rand(1, 200)} ${pick(["Main St", "Market Rd", "Unity Close", "Freedom Way", "Commerce Ave"])}, ${branch.name}`,
        }).returning();
        customersByBranch[branch.id].push(c);
        customerList.push(c);
      }
    }
    console.log(`✅ Created customers (total: ${customerList.length})`);
  } else {
    console.log(`ℹ️  Reusing ${customerList.length} existing customers`);
    for (const branch of branchList) {
      customersByBranch[branch.id] = customerList.filter(c => c.branchId === branch.id);
    }
  }

  // ── 6. Orders (200 per branch = 1000 total) ───────────────────────────────
  const existingOrderCount = await db.select().from(orders).where(eq(orders.laundryId, laundryId));
  if (existingOrderCount.length >= 1000) {
    console.log(`ℹ️  Already have ${existingOrderCount.length} orders — skipping order creation`);
  } else {
    console.log("Creating 1000 orders across 5 branches...");
    type OrderStatus = "pending"|"processing"|"ready"|"partial_pickup"|"completed"|"cancelled";
    const PAY_STATUSES: Array<"unpaid"|"partial"|"paid"> = ["unpaid","partial","paid"];
    const SVC_TYPES: Array<"standard"|"express"|"premium"> = ["standard","express","premium"];
    let ordersCreated = 0;
    let discountRequestsCreated = 0;
    let paymentsCreated = 0;

    for (const branch of branchList) {
      const branchCustomers = customersByBranch[branch.id] ?? [];
      const branchWorkers = workerList.filter(w => w.branchId === branch.id);

      for (let i = 0; i < 200; i++) {
        const customer = pick(branchCustomers);
        const serviceType = pick(SVC_TYPES);
        const shirts = rand(1, 8);
        const trousers = rand(0, 5);
        const pricePerShirt = serviceType === "express" ? 1200 : serviceType === "premium" ? 1500 : 800;
        const pricePerTrouser = serviceType === "express" ? 1500 : serviceType === "premium" ? 2000 : 1000;
        const basePrice = shirts * pricePerShirt + trousers * pricePerTrouser;
        const daysBack = rand(0, 90);
        const createdAt = daysAgo(daysBack);

        // Determine status with realistic age-based distribution.
        // All 6 schema statuses represented: pending, processing, ready,
        // partial_pickup, completed, cancelled.
        let status: OrderStatus = "pending";
        if (daysBack > 60) {
          status = pick<OrderStatus>(["completed","completed","completed","cancelled","partial_pickup"]);
        } else if (daysBack > 30) {
          status = pick<OrderStatus>(["processing","ready","completed","completed","partial_pickup","cancelled"]);
        } else if (daysBack > 7) {
          status = pick<OrderStatus>(["pending","processing","ready","partial_pickup","cancelled"]);
        } else {
          status = pick<OrderStatus>(["pending","pending","processing","ready"]);
        }

        // Payment aligned with status
        let paymentStatus: "unpaid"|"partial"|"paid" = "unpaid";
        let amountPaid = 0;
        if (status === "completed") {
          paymentStatus = Math.random() > 0.1 ? "paid" : "partial";
        } else if (status === "cancelled") {
          // cancelled orders: mostly unpaid, occasionally partially paid (refund scenario)
          paymentStatus = Math.random() > 0.8 ? "partial" : "unpaid";
        } else if (status === "partial_pickup") {
          paymentStatus = pick(["partial", "paid"]);
        } else {
          paymentStatus = pick(PAY_STATUSES);
        }
        if (paymentStatus === "paid") amountPaid = basePrice;
        else if (paymentStatus === "partial") amountPaid = Math.floor(basePrice * rand(30, 70) / 100);

        // Partial pickup quantities
        const shirtsPickedUp = status === "completed"
          ? shirts
          : status === "partial_pickup"
            ? rand(1, Math.max(1, shirts - 1))
            : 0;
        const trousersPickedUp = status === "completed"
          ? trousers
          : status === "partial_pickup" && trousers > 0
            ? rand(0, trousers - 1)
            : 0;

        const worker = pick(branchWorkers);
        const orderId = nextOrderId();

        const [order] = await db.insert(orders).values({
          laundryId,
          branchId: branch.id,
          customerId: customer.id,
          orderId,
          customerName: customer.fullName,
          phone: customer.phone,
          serviceType,
          shirts,
          trousers,
          shirtsPickedUp,
          trousersPickedUp,
          status,
          paymentStatus,
          price: basePrice.toString(),
          amountPaid: amountPaid.toString(),
          assignedWorkerId: worker.id,
          createdAt,
          updatedAt: createdAt,
        }).returning();

        ordersCreated++;

        // Payment record for paid/partial orders
        if (amountPaid > 0) {
          const receipt = nextReceipt();
          await db.insert(paymentRecords).values({
            orderId: order.id,
            laundryId,
            branchId: branch.id,
            receiptNumber: receipt,
            amount: amountPaid.toString(),
            method: pick(["cash","transfer","pos"]),
            remainingBalance: Math.max(0, basePrice - amountPaid).toString(),
            recordedBy: worker.name,
            workerId: worker.id,
            recordedAt: new Date(createdAt.getTime() + rand(1, 12) * 3600000),
          });
          paymentsCreated++;
        }

        // Discount scenarios
        const discRoll = Math.random();

        if (discRoll < 0.08) {
          // Auto-approved discount (≤₦500)
          const discAmount = rand(100, 500);
          await db.insert(priceAdjustments).values({
            orderId: order.id,
            laundryId,
            type: "discount",
            amount: discAmount.toString(),
            reason: pick(["Loyal customer","Minor stain issue","Repeat customer","Early drop-off"]),
            appliedBy: worker.name,
          });
          await db.update(orders).set({ discount: discAmount.toString() }).where(eq(orders.id, order.id));

        } else if (discRoll < 0.14) {
          // Pending approval (₦501–₦2000)
          const discAmount = rand(501, 2000);
          await db.insert(discountApprovals).values({
            laundryId,
            orderId: order.id,
            requestedBy: worker.id,
            requestedByName: worker.name,
            originalAmount: basePrice.toString(),
            requestedDiscount: discAmount.toString(),
            reason: pick(["Damaged item compensation","VIP customer","Major complaint","Bulk order discount"]),
            status: "pending",
            createdAt,
          });
          discountRequestsCreated++;

        } else if (discRoll < 0.19) {
          // Approved discount (₦501–₦1500)
          const discAmount = rand(501, 1500);
          await db.insert(discountApprovals).values({
            laundryId,
            orderId: order.id,
            requestedBy: worker.id,
            requestedByName: worker.name,
            originalAmount: basePrice.toString(),
            requestedDiscount: discAmount.toString(),
            reason: pick(["Item delay compensation","Customer escalation resolved","Management approval"]),
            status: "approved",
            resolvedBy: "Owner",
            resolvedAt: new Date(createdAt.getTime() + rand(1, 24) * 3600000),
            createdAt,
          });
          await db.insert(priceAdjustments).values({
            orderId: order.id,
            laundryId,
            type: "discount",
            amount: discAmount.toString(),
            reason: `Approved discount — ${pick(["Item delay compensation","Customer escalation resolved","Management approval"])}`,
            appliedBy: worker.name,
          });
          await db.update(orders).set({ discount: discAmount.toString() }).where(eq(orders.id, order.id));
          discountRequestsCreated++;

        } else if (discRoll < 0.22) {
          // Rejected discount
          const discAmount = rand(1000, 4000);
          await db.insert(discountApprovals).values({
            laundryId,
            orderId: order.id,
            requestedBy: worker.id,
            requestedByName: worker.name,
            originalAmount: basePrice.toString(),
            requestedDiscount: discAmount.toString(),
            reason: pick(["Customer demanded large discount","Worker error claim","Disputed pricing"]),
            status: "rejected",
            resolvedBy: "Owner",
            resolvedAt: new Date(createdAt.getTime() + rand(1, 24) * 3600000),
            createdAt,
          });
          discountRequestsCreated++;
        }

        if (ordersCreated % 100 === 0) {
          console.log(`  ... ${ordersCreated} orders created`);
        }
      }

      // ── Branch expenditures ──────────────────────────────────────────────
      for (let m = 0; m < 3; m++) {
        for (const cat of EXPENSE_NAMES) {
          const amount = rand(5000, 80000);
          await db.insert(expenditures).values({
            laundryId,
            category: cat,
            amount: amount.toString(),
            notes: `${branch.name} — ${cat} expense`,
            isRecurring: ["electricity","water","salaries"].includes(cat),
            createdAt: daysAgo(m * 30 + rand(0, 29)),
          });
        }
      }
    }

    console.log(`✅ Created ${ordersCreated} orders, ${paymentsCreated} payments, ${discountRequestsCreated} discount requests`);
    console.log(`✅ Created expenditures for all branches`);
  }

  // ── 7. Batches (2 per branch = 10 total) ──────────────────────────────────
  const existingBatchCount = await db.select().from(batches).where(eq(batches.laundryId, laundryId));
  if (existingBatchCount.length > 0) {
    console.log(`ℹ️  Skipping batches — already seeded (${existingBatchCount.length} found)`);
  } else {
    console.log("Creating demo batches...");
    let batchesCreated = 0;
    for (const branch of branchList) {
      // Collect 'processing' orders for this branch to populate batches
      const branchOrders = await db.select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.laundryId, laundryId), eq(orders.branchId, branch.id), eq(orders.status, "processing")))
        .limit(16);

      // Batch 1: active (currently being processed)
      const [activeBatch] = await db.insert(batches).values({
        laundryId,
        batchCode: `DEMO-${branch.name.replace(/\s+/g, "").toUpperCase().slice(0, 6)}-A`,
        status: "active",
        orderCount: Math.min(8, branchOrders.length),
        createdAt: daysAgo(rand(1, 3)),
      }).returning();
      // Link first 8 orders to the active batch
      if (branchOrders.length > 0) {
        const active8 = branchOrders.slice(0, 8).map(o => o.id);
        await db.update(orders).set({ batchId: activeBatch.id }).where(
          inArray(orders.id, active8)
        );
      }

      // Batch 2: completed (processed earlier)
      const [completedBatch] = await db.insert(batches).values({
        laundryId,
        batchCode: `DEMO-${branch.name.replace(/\s+/g, "").toUpperCase().slice(0, 6)}-C`,
        status: "completed",
        orderCount: Math.min(8, Math.max(0, branchOrders.length - 8)),
        createdAt: daysAgo(rand(5, 14)),
      }).returning();
      if (branchOrders.length > 8) {
        const completed8 = branchOrders.slice(8, 16).map(o => o.id);
        await db.update(orders).set({ batchId: completedBatch.id }).where(
          inArray(orders.id, completed8)
        );
      }

      batchesCreated += 2;
    }
    console.log(`✅ Created ${batchesCreated} batches (1 active + 1 completed per branch)`);
  }

  // ── 8. WhatsApp Conversations ─────────────────────────────────────────────
  function normalizePhone(raw: string): string {
    const s = raw.replace(/[\s\-().+]/g, "");
    if (s.startsWith("0") && s.length === 11) return "+234" + s.slice(1);
    if (s.startsWith("234") && s.length === 13) return "+" + s;
    if (s.startsWith("+")) return s;
    return "+" + s;
  }

  const existingConvCount = await db.select().from(conversations).where(eq(conversations.laundryId, laundryId));
  if (existingConvCount.length > 0) {
    console.log(`ℹ️  Skipping WhatsApp conversations — already seeded (${existingConvCount.length} found)`);
  } else {
    console.log("Creating demo WhatsApp conversations...");

    type ConvThread = {
      customerIdx: number;
      status: "open" | "resolved" | "archived";
      messages: { direction: "inbound" | "outbound"; body: string; minutesAgo: number }[];
    };

    const threads: ConvThread[] = [
      {
        customerIdx: 0, status: "open",
        messages: [
          { direction: "inbound",  body: "Hello good morning. I dropped my clothes yesterday evening. When will they be ready?", minutesAgo: 480 },
          { direction: "outbound", body: "Good morning! Your items are being processed. They should be ready by 3PM today. We'll send you a message when done 🧺", minutesAgo: 470 },
          { direction: "inbound",  body: "Ok thank you. How much will the total be?", minutesAgo: 460 },
          { direction: "outbound", body: "For 4 shirts and 2 trousers on standard service, your total is ₦5,800. Payment on pickup is fine!", minutesAgo: 455 },
          { direction: "inbound",  body: "Alright. Can I also add one native attire?", minutesAgo: 120 },
        ],
      },
      {
        customerIdx: 1, status: "resolved",
        messages: [
          { direction: "inbound",  body: "Please is my order ready? I brought them in on Monday", minutesAgo: 1440 },
          { direction: "outbound", body: "So sorry for the delay! Your clothes are ready for pickup now. We apologise for the wait 🙏", minutesAgo: 1400 },
          { direction: "inbound",  body: "Ok I'm coming now", minutesAgo: 1380 },
          { direction: "outbound", body: "Perfect! See you soon 😊 We're open till 7PM today.", minutesAgo: 1370 },
          { direction: "inbound",  body: "Thank you, I've picked them up. Good work!", minutesAgo: 1200 },
          { direction: "outbound", body: "Thank you for using CleanTrack! We look forward to serving you again 🙌", minutesAgo: 1190 },
        ],
      },
      {
        customerIdx: 2, status: "open",
        messages: [
          { direction: "inbound",  body: "Good afternoon. How much do you charge for suits?", minutesAgo: 600 },
          { direction: "outbound", body: "Good afternoon! Suit dry cleaning is ₦4,000 for standard service or ₦6,500 for express (same-day). Would you like to bring it in?", minutesAgo: 590 },
          { direction: "inbound",  body: "Express sounds good. Are you open on Saturdays?", minutesAgo: 580 },
          { direction: "outbound", body: "Yes! We're open Monday to Saturday, 8AM to 7PM 📅", minutesAgo: 575 },
          { direction: "inbound",  body: "Great, I'll come in tomorrow morning with 2 suits", minutesAgo: 570 },
        ],
      },
      {
        customerIdx: 3, status: "resolved",
        messages: [
          { direction: "inbound",  body: "The collar of my white shirt still has a stain. I paid for premium washing", minutesAgo: 2880 },
          { direction: "outbound", body: "We sincerely apologise for this! Please bring the shirt back and we will re-wash it free of charge and prioritise it.", minutesAgo: 2840 },
          { direction: "inbound",  body: "Ok, I'll bring it by tomorrow", minutesAgo: 2820 },
          { direction: "outbound", body: "Thank you for understanding. Ask for the manager when you arrive and we'll sort it out immediately.", minutesAgo: 2810 },
          { direction: "inbound",  body: "Done, just picked it up. Collar is spotless now, thank you", minutesAgo: 1440 },
          { direction: "outbound", body: "We're glad we could make it right! Thank you for your patience 🙏", minutesAgo: 1430 },
        ],
      },
      {
        customerIdx: 4, status: "open",
        messages: [
          { direction: "inbound",  body: "Do you offer home pickup and delivery?", minutesAgo: 300 },
          { direction: "outbound", body: "Yes! We offer pickup and delivery within our service area. Delivery fee is ₦500 per trip. Shall I schedule one for you?", minutesAgo: 295 },
          { direction: "inbound",  body: "Nice! How do I book it?", minutesAgo: 290 },
          { direction: "inbound",  body: "Anyone there?", minutesAgo: 30 },
        ],
      },
      {
        customerIdx: 5, status: "archived",
        messages: [
          { direction: "inbound",  body: "Hello, what are your prices for children's clothes?", minutesAgo: 5760 },
          { direction: "outbound", body: "Hi! Children's clothes: shirts ₦400, trousers ₦500, dresses ₦600. Any questions?", minutesAgo: 5740 },
          { direction: "inbound",  body: "Thank you, I'll check and get back to you", minutesAgo: 5720 },
        ],
      },
      {
        customerIdx: 6, status: "resolved",
        messages: [
          { direction: "inbound",  body: "I'm at the shop to pick up my order but you said its not ready. The app says ready", minutesAgo: 720 },
          { direction: "outbound", body: "We sincerely apologise for the confusion! Please give us 10 minutes — the finishing team is ironing the last items now.", minutesAgo: 710 },
          { direction: "inbound",  body: "Ok fine", minutesAgo: 700 },
          { direction: "outbound", body: "Your order is ready! Sorry again for the wait. We added a discount to your next order as an apology 🙏", minutesAgo: 680 },
          { direction: "inbound",  body: "No problem. Thank you", minutesAgo: 670 },
        ],
      },
      {
        customerIdx: 7, status: "open",
        messages: [
          { direction: "inbound",  body: "Please can I pay online or only cash?", minutesAgo: 200 },
          { direction: "outbound", body: "We accept cash, bank transfer, and POS! For transfer, please use the account details on your receipt. Let us know if you need anything else.", minutesAgo: 195 },
          { direction: "inbound",  body: "Perfect. I'll do a transfer when I come for pickup", minutesAgo: 190 },
        ],
      },
      {
        customerIdx: 8, status: "resolved",
        messages: [
          { direction: "inbound",  body: "Is there any discount for bringing more than 20 pieces at once?", minutesAgo: 4320 },
          { direction: "outbound", body: "Great question! Yes — for 20+ pieces we offer 10% off the total. Shall I note this for your next drop-off?", minutesAgo: 4310 },
          { direction: "inbound",  body: "Yes please. I'll bring 25 pieces next week", minutesAgo: 4300 },
          { direction: "outbound", body: "Wonderful! We'll have it noted. See you next week 🧺✨", minutesAgo: 4290 },
        ],
      },
      {
        customerIdx: 9, status: "open",
        messages: [
          { direction: "inbound",  body: "My order number is LT-2024-0891. Any update on when it will be ready?", minutesAgo: 90 },
          { direction: "outbound", body: "Hi! Let me check that for you right now… Your order is currently being processed and should be ready by end of day today.", minutesAgo: 85 },
          { direction: "inbound",  body: "End of day meaning what time?", minutesAgo: 60 },
          { direction: "inbound",  body: "Still waiting for a reply", minutesAgo: 5 },
        ],
      },
    ];

    let convsCreated = 0;
    let msgsCreated = 0;

    for (let t = 0; t < threads.length; t++) {
      const thread = threads[t];
      const branchIdx = Math.floor(t / 2);
      const branch = branchList[branchIdx] ?? branchList[0];
      const branchCustomers = customersByBranch[branch.id] ?? [];
      if (!branchCustomers.length) continue;
      const customer = branchCustomers[thread.customerIdx % branchCustomers.length];
      const phone = normalizePhone(customer.phone);

      const now = Date.now();
      const lastMsgMinutesAgo = Math.min(...thread.messages.map(m => m.minutesAgo));
      const lastMessageAt = new Date(now - lastMsgMinutesAgo * 60_000);

      const unreadCount = thread.status === "open"
        ? thread.messages.filter(m => m.direction === "inbound").length > 0
          ? thread.messages.filter((m, i) => m.direction === "inbound" && i === thread.messages.length - 1 ? 1 : 0).length
          : 0
        : 0;

      const [conv] = await db.insert(conversations).values({
        laundryId,
        customerId: customer.id,
        customerName: customer.fullName ?? null,
        customerPhone: phone,
        channel: "whatsapp",
        status: thread.status,
        unreadCount: thread.status === "open" ? thread.messages.filter(m => m.direction === "inbound").slice(-2).length : 0,
        lastMessageAt,
        createdAt: new Date(now - Math.max(...thread.messages.map(m => m.minutesAgo)) * 60_000),
        updatedAt: lastMessageAt,
      }).returning();
      convsCreated++;

      for (const msg of thread.messages) {
        const msgTime = new Date(now - msg.minutesAgo * 60_000);
        await db.insert(conversationMessages).values({
          conversationId: conv.id,
          laundryId,
          direction: msg.direction,
          body: msg.body,
          senderType: msg.direction === "inbound" ? "customer" : "owner",
          senderName: msg.direction === "inbound" ? (customer.fullName ?? undefined) : "CleanTrack",
          status: msg.direction === "outbound" ? "delivered" : null,
          createdAt: msgTime,
        });
        msgsCreated++;
      }
    }

    console.log(`✅ Created ${convsCreated} WhatsApp conversations, ${msgsCreated} messages`);
  }

  // ── 8. Final counts ───────────────────────────────────────────────────────
  const [orderCount] = await db.select().from(orders).where(eq(orders.laundryId, laundryId));
  const allOrders = await db.select().from(orders).where(eq(orders.laundryId, laundryId));
  const allDiscounts = await db.select().from(discountApprovals).where(eq(discountApprovals.laundryId, laundryId));

  const branchRevenue: Record<string, number> = {};
  for (const branch of branchList) {
    const bOrders = allOrders.filter(o => o.branchId === branch.id);
    branchRevenue[branch.name] = bOrders.reduce((s, o) => s + parseFloat(o.price || "0"), 0);
  }
  const totalRevenue = Object.values(branchRevenue).reduce((a, b) => a + b, 0);

  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEMO ENVIRONMENT READY");
  console.log("=".repeat(60));
  console.log("\n📋 DEMO LOGIN CREDENTIALS");
  console.log("-".repeat(60));
  console.log(`Owner Email    : ${DEMO_EMAIL}`);
  console.log(`Owner Password : ${DEMO_PASS}`);
  console.log("\n🏪 WORKER CREDENTIALS (Phone + PIN login at Worker Station)");
  console.log("-".repeat(60));
  const demoWorkers = workerCredentials.slice(0, 10);
  for (const w of demoWorkers) {
    console.log(`  Branch A (${w.branch}): ${w.name} | Phone: ${w.phone} | PIN: ${w.pin}`);
    break; // just show first two
  }
  // Show one worker from Branch A and one from Branch B
  const branchAWorker = workerCredentials.find(w => w.branch === branchList[0]?.name);
  const branchBWorker = workerCredentials.find(w => w.branch === branchList[1]?.name);
  if (branchAWorker) {
    console.log(`  Branch A (${branchAWorker.branch}): ${branchAWorker.name}`);
    console.log(`    Phone: ${branchAWorker.phone} | PIN: ${branchAWorker.pin}`);
  }
  if (branchBWorker) {
    console.log(`  Branch B (${branchBWorker.branch}): ${branchBWorker.name}`);
    console.log(`    Phone: ${branchBWorker.phone} | PIN: ${branchBWorker.pin}`);
  }

  console.log("\n📊 DEMO DATA SUMMARY");
  console.log("-".repeat(60));
  console.log(`  Branches   : ${branchList.length}`);
  console.log(`  Workers    : ${workerList.length}`);
  console.log(`  Customers  : ${customerList.length}`);
  console.log(`  Orders     : ${allOrders.length}`);
  console.log(`    pending        : ${allOrders.filter(o => o.status === "pending").length}`);
  console.log(`    processing     : ${allOrders.filter(o => o.status === "processing").length}`);
  console.log(`    ready          : ${allOrders.filter(o => o.status === "ready").length}`);
  console.log(`    partial_pickup : ${allOrders.filter(o => o.status === "partial_pickup").length}`);
  console.log(`    completed      : ${allOrders.filter(o => o.status === "completed").length}`);
  console.log(`    cancelled      : ${allOrders.filter(o => o.status === "cancelled").length}`);
  console.log(`  Discount Requests: ${allDiscounts.length}`);
  console.log(`    Pending  : ${allDiscounts.filter(d => d.status === "pending").length}`);
  console.log(`    Approved : ${allDiscounts.filter(d => d.status === "approved").length}`);
  console.log(`    Rejected : ${allDiscounts.filter(d => d.status === "rejected").length}`);
  console.log("\n💰 REVENUE BY BRANCH");
  console.log("-".repeat(60));
  for (const [name, rev] of Object.entries(branchRevenue)) {
    console.log(`  ${name.padEnd(25)}: ₦${rev.toLocaleString()}`);
  }
  console.log(`  ${"TOTAL".padEnd(25)}: ₦${totalRevenue.toLocaleString()}`);

  console.log("\n🔒 DISCOUNT SETTINGS (Auto-Approval Threshold)");
  console.log("-".repeat(60));
  console.log("  Auto-approve threshold : ₦500");
  console.log("  Max discount per order : ₦5,000");
  console.log("  Max discount percentage: 20%");
  console.log("\n  Test cases:");
  console.log("    ₦200 → AUTO APPROVED (below threshold)");
  console.log("    ₦500 → AUTO APPROVED (at threshold)");
  console.log("    ₦501 → PENDING APPROVAL (above threshold)");
  console.log("    ₦2000 → PENDING APPROVAL");
  console.log("    ₦5001 → REJECTED (exceeds max)");

  console.log("\n✅ Demo environment is ready. All data is safe for testing.\n");

  await pool.end();
}

main().catch(err => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
