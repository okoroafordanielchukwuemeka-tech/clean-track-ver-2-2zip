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
import { eq, and } from "drizzle-orm";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const {
  laundries, branches, workers, customers, orders,
  paymentRecords, priceAdjustments, discountApprovals, services,
  expenditures, expenseCategories, messageTemplates,
} = schema;

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
  { name: "Shirts (Wash & Iron)", category: "clothing", standardPrice: "800", expressPrice: "1200", premiumPrice: "1500" },
  { name: "Trousers (Wash & Iron)", category: "clothing", standardPrice: "1000", expressPrice: "1500", premiumPrice: "2000" },
  { name: "Suits (Full Dry Clean)", category: "formal", standardPrice: "4000", expressPrice: "6000", premiumPrice: "8000" },
  { name: "Dresses", category: "clothing", standardPrice: "1500", expressPrice: "2200", premiumPrice: "3000" },
  { name: "Bedsheets (Single)", category: "bedding", standardPrice: "1200", expressPrice: "1800", premiumPrice: "2500" },
  { name: "Duvet / Comforter", category: "bedding", standardPrice: "3500", expressPrice: "5000", premiumPrice: "7000" },
  { name: "Agbada (Full Set)", category: "traditional", standardPrice: "5000", expressPrice: "7500", premiumPrice: "10000" },
  { name: "Ankara Fabric (Piece)", category: "traditional", standardPrice: "1800", expressPrice: "2500", premiumPrice: "3500" },
  { name: "Sneakers (Pair)", category: "footwear", standardPrice: "2500", expressPrice: "3500", premiumPrice: "5000" },
  { name: "Leather Shoes (Pair)", category: "footwear", standardPrice: "2000", expressPrice: "3000", premiumPrice: "4500" },
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

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
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

  // Update discount settings regardless (ensure threshold = 500)
  await db.update(laundries).set({
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
        const pin = WORKER_PINS[wIdx % WORKER_PINS.length];
        const name = randomName();
        const phone = randomPhone();
        const [w] = await db.insert(workers).values({
          laundryId,
          branchId: branch.id,
          name,
          phone,
          pin,
          role: i === 0 ? "admin" : "worker",
          isActive: true,
        }).returning();
        workersCreated.push(w);
        workerCredentials.push({ branch: branch.name, name, phone, pin });
        wIdx++;
      }
    }
    workerList = [...workerList, ...workersCreated];
    console.log(`✅ Created ${workersCreated.length} workers (total: ${workerList.length})`);
  } else {
    console.log(`ℹ️  Reusing ${workerList.length} existing workers`);
    // Build credentials from existing
    for (const w of workerList) {
      const branch = branchList.find(b => b.id === w.branchId);
      if (w.phone && w.pin) {
        workerCredentials.push({ branch: branch?.name ?? "?", name: w.name, phone: w.phone, pin: w.pin });
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
    const STATUSES: Array<"pending"|"processing"|"ready"|"completed"> = ["pending","processing","ready","completed"];
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

        // Determine status based on age
        let status: "pending"|"processing"|"ready"|"completed" = "pending";
        if (daysBack > 60) status = "completed";
        else if (daysBack > 30) status = pick(["processing","ready","completed"]);
        else if (daysBack > 7) status = pick(["pending","processing","ready"]);
        else status = pick(["pending","processing"]);

        // Payment aligned with status
        let paymentStatus: "unpaid"|"partial"|"paid" = "unpaid";
        let amountPaid = 0;
        if (status === "completed") {
          paymentStatus = Math.random() > 0.1 ? "paid" : "partial";
        } else {
          paymentStatus = pick(PAY_STATUSES);
        }
        if (paymentStatus === "paid") amountPaid = basePrice;
        else if (paymentStatus === "partial") amountPaid = Math.floor(basePrice * rand(30, 70) / 100);

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
          shirtsPickedUp: status === "completed" ? shirts : 0,
          trousersPickedUp: status === "completed" ? trousers : 0,
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

  // ── 7. Final counts ───────────────────────────────────────────────────────
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
