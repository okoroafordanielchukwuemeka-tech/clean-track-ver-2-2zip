/**
 * CleanTrack Full Stress Test — 50 Customers / 200 Orders
 * Generates realistic operational data including payments, pickups,
 * discount approvals (pending/approved/rejected), and audit log entries.
 *
 * Run: cd artifacts/api-server && npx tsx ../../scripts/seed-test-data.ts
 */

import { db } from "@workspace/db";
import {
  laundries, orders, orderItems, customers, services, workers,
  workerPermissions, priceAdjustments, paymentRecords, pickupRecords,
  notifications, discountApprovals, auditLog,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";

const BASE = "http://localhost:3001/api";

async function apiCall(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(err)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function rnd<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rndFloat(min: number, max: number) { return Math.random() * (max - min) + min; }
function daysAgo(n: number) { return new Date(Date.now() - n * 86400000); }
function hoursAgo(n: number) { return new Date(Date.now() - n * 3600000); }
function hoursFromNow(n: number) { return new Date(Date.now() + n * 3600000); }

function generateOrderId() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${datePart}${rand}`;
}

// ─── Nigerian Names & Data ───────────────────────────────────────────────────
const FIRST_NAMES = [
  "Chidi", "Amaka", "Emeka", "Ngozi", "Tunde", "Bisi", "Kemi", "Fola",
  "Seun", "Yemi", "Adaeze", "Ifeanyi", "Chiamaka", "Chukwuemeka", "Obioma",
  "Ifeoma", "Nkechi", "Onyekachi", "Chioma", "Ebuka", "Dayo", "Tobi",
  "Funmi", "Ade", "Sola", "Gbenga", "Lola", "Wale", "Kunle", "Bola",
  "Feyi", "Remi", "Jide", "Titi", "Bukola", "Shola", "Femi", "Yetunde",
  "Akin", "Olu", "Taiwo", "Kehinde", "Blessing", "Grace", "Faith", "Joy",
  "Emmanuel", "Daniel", "Samuel", "David",
];

const LAST_NAMES = [
  "Okonkwo", "Adeyemi", "Okafor", "Balogun", "Nwosu", "Adeleke", "Chukwu",
  "Osei", "Eze", "Babatunde", "Afolabi", "Nwankwo", "Oduya", "Fashola",
  "Adesanya", "Obi", "Umeh", "Nduka", "Okoro", "Ajani", "Fadeyi", "Coker",
  "Bankole", "Odion", "Isibor", "Oghenekaro", "Nwosu", "Abiodun", "Ogundele",
  "Adegoke", "Ayorinde", "Fayemi", "Olorunfemi", "Adetutu", "Omowale",
];

const STREETS = [
  "Marina Street", "Allen Avenue", "Herbert Macaulay Way", "Ozumba Mbadiwe",
  "Ahmadu Bello Way", "Broad Street", "Awolowo Road", "Bourdillon Road",
  "Obafemi Awolowo Crescent", "Nnamdi Azikiwe Street", "Adeola Odeku Street",
  "Kofo Abayomi Street", "Sanusi Fafunwa Street", "Karimu Kotun Street",
  "Ligali Ayorinde Avenue", "Bode Thomas Street", "Eric Moore Road",
];

const AREAS = [
  "Lagos Island", "Victoria Island", "Ikoyi", "Lekki Phase 1", "Surulere",
  "Yaba", "Ikeja", "Gbagada", "Ojodu", "Magodo", "Maryland", "Apapa",
  "Festac", "Ago Palace", "Ejigbo", "Oshodi", "Mushin",
];

function randomPhone() {
  const prefixes = ["0803", "0806", "0810", "0812", "0815", "0816", "0701", "0703", "0705", "0706", "0802", "0808", "0901", "0902", "0907", "0908"];
  return rnd(prefixes) + String(rndInt(1000000, 9999999));
}

function randomAddress() {
  return `${rndInt(1, 150)} ${rnd(STREETS)}, ${rnd(AREAS)}`;
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   CleanTrack Full Stress Test — 50 Customers / 200 Orders ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // ─── 0. Wipe Everything ───────────────────────────────────────────────────
  console.log("🧹 Wiping all existing data...");
  await db.delete(pickupRecords);
  await db.delete(auditLog);
  await db.delete(discountApprovals);
  await db.delete(paymentRecords);
  await db.delete(priceAdjustments);
  await db.delete(orderItems);
  await db.delete(notifications);
  await db.delete(orders);
  await db.delete(customers);
  await db.delete(workerPermissions);
  await db.delete(workers);
  await db.delete(services);
  await db.delete(laundries);
  console.log("✅ Cleaned\n");

  // ─── 1. Owner + Laundry ───────────────────────────────────────────────────
  console.log("🏢 Creating owner + laundry...");
  const signupRes = await apiCall("POST", "/auth/signup", {
    businessName: "CleanTrack Demo Laundry",
    ownerEmail: "owner@test.com",
    password: "password123",
    phone: "08012345678",
  });
  const token: string = signupRes.token;
  const laundryId: number = signupRes.laundry.id;

  // Configure SLA
  await apiCall("PATCH", "/settings/sla", {
    standardTurnaroundHours: 72, expressTurnaroundHours: 24, premiumTurnaroundHours: 48,
  }, token);

  // Configure discount rules
  await db.update(laundries).set({
    discountSettings: {
      maxDiscountPerOrder: 5000,
      maxDiscountPercentage: 20,
      autoApprovalThreshold: 500,
    }
  }).where(eq(laundries.id, laundryId));

  console.log(`✅ Laundry ID: ${laundryId}\n`);

  // ─── 2. Services ──────────────────────────────────────────────────────────
  console.log("👕 Creating services catalog...");
  const svcDefs = [
    { name: "Shirt", category: "Clothing", standardPrice: 500, expressPrice: 750, premiumPrice: 1000 },
    { name: "Trouser", category: "Clothing", standardPrice: 600, expressPrice: 900, premiumPrice: 1200 },
    { name: "Dress", category: "Clothing", standardPrice: 800, expressPrice: 1200, premiumPrice: 1600 },
    { name: "Suit (2-piece)", category: "Clothing", standardPrice: 2000, expressPrice: 3000, premiumPrice: 4000 },
    { name: "Agbada Set", category: "Clothing", standardPrice: 3000, expressPrice: 4500, premiumPrice: 6000 },
    { name: "Duvet (Single)", category: "Bedding", standardPrice: 2500, expressPrice: 3500, premiumPrice: 5000 },
    { name: "Duvet (Double)", category: "Bedding", standardPrice: 3500, expressPrice: 5000, premiumPrice: 7000 },
    { name: "Rug (Small)", category: "Bedding", standardPrice: 1500, expressPrice: 2200, premiumPrice: 3000 },
    { name: "Rug (Large)", category: "Bedding", standardPrice: 3000, expressPrice: 4500, premiumPrice: 6000 },
    { name: "Curtain (Single Panel)", category: "Home Linen", standardPrice: 1200, expressPrice: 1800, premiumPrice: 2500 },
    { name: "Blanket", category: "Home Linen", standardPrice: 2000, expressPrice: 3000, premiumPrice: 4000 },
    { name: "Towel", category: "Home Linen", standardPrice: 400, expressPrice: 600, premiumPrice: 800 },
    { name: "Pillowcase", category: "Home Linen", standardPrice: 300, expressPrice: 450, premiumPrice: 600 },
    { name: "Bedsheet (Single)", category: "Home Linen", standardPrice: 1000, expressPrice: 1500, premiumPrice: 2000 },
    { name: "Bedsheet (Double)", category: "Home Linen", standardPrice: 1500, expressPrice: 2200, premiumPrice: 3000 },
  ];

  const createdSvcs: Record<string, any> = {};
  for (const svc of svcDefs) {
    const s = await apiCall("POST", "/services", svc, token);
    createdSvcs[svc.name] = s;
  }
  console.log(`✅ ${Object.keys(createdSvcs).length} services created\n`);

  // ─── 3. Workers ───────────────────────────────────────────────────────────
  console.log("👷 Creating workers...");
  const workerDefs = [
    { name: "Amaka Obi", phone: "08099999999", pin: "1234", role: "admin" },
    { name: "Chukwu Eze", phone: "08088888888", pin: "2345", role: "worker" },
    { name: "Funmi Adeleke", phone: "08077777777", pin: "3456", role: "worker" },
    { name: "Tunde Balogun", phone: "08066666666", pin: "4567", role: "worker" },
  ];
  const createdWorkers: any[] = [];
  for (const w of workerDefs) {
    const wr = await apiCall("POST", "/workers", w, token);
    createdWorkers.push(wr);
    console.log(`  · ${wr.name} (ID ${wr.id}, PIN: ${w.pin})`);
  }
  console.log(`✅ ${createdWorkers.length} workers created\n`);

  // ─── 4. Customers (50) ────────────────────────────────────────────────────
  console.log("👥 Creating 50 customers...");
  const usedPhones = new Set<string>();
  const customerRows: typeof customers.$inferInsert[] = [];

  for (let i = 0; i < 50; i++) {
    const first = rnd(FIRST_NAMES);
    const last = rnd(LAST_NAMES);
    let phone = randomPhone();
    while (usedPhones.has(phone)) phone = randomPhone();
    usedPhones.add(phone);

    const createdAt = daysAgo(rndInt(10, 180));
    customerRows.push({
      laundryId,
      fullName: `${first} ${last}`,
      phone,
      address: Math.random() > 0.2 ? randomAddress() : null,
      notes: Math.random() > 0.7 ? rnd(["VIP customer", "Handle with care", "Allergic to certain detergents", "Preferred worker: Amaka", "Regular — give loyalty discount"]) : null,
      createdAt,
      lastActivityAt: createdAt,
    });
  }

  const insertedCustomers = await db.insert(customers).values(customerRows).returning();
  console.log(`✅ ${insertedCustomers.length} customers created\n`);

  // ─── 5. Orders (200) with items, payments, pickups ───────────────────────
  console.log("📦 Creating 200 orders with full lifecycle data...");

  const svcNames = Object.keys(createdSvcs);
  const STATUSES = ["pending", "processing", "ready", "partial_pickup", "completed"] as const;
  const PAY_STATUSES = ["unpaid", "partial", "paid"] as const;
  const SERVICE_TYPES = ["standard", "express", "premium"] as const;

  type Status = typeof STATUSES[number];
  type PayStatus = typeof PAY_STATUSES[number];
  type SvcType = typeof SERVICE_TYPES[number];

  // Distribution weights for statuses
  const STATUS_DIST: Status[] = [
    "pending", "pending", "pending", "pending",           // ~20%
    "processing", "processing", "processing", "processing", "processing", // ~25%
    "ready", "ready", "ready",                            // ~15%
    "partial_pickup", "partial_pickup",                   // ~10%
    "completed", "completed", "completed", "completed", "completed", "completed", // ~30%
  ];

  const SVC_DIST: SvcType[] = [
    "standard", "standard", "standard", "standard", "standard", "standard", // 60%
    "express", "express", "express",                      // 30%
    "premium",                                            // 10%
  ];

  // Service price lookup
  function getPrice(svcName: string, svcType: SvcType): number {
    const svc = createdSvcs[svcName];
    if (svcType === "express") return Number(svc.expressPrice ?? svc.standardPrice);
    if (svcType === "premium") return Number(svc.premiumPrice ?? svc.standardPrice);
    return Number(svc.standardPrice);
  }

  // SLA turnaround
  function slaHours(svcType: SvcType): number {
    if (svcType === "express") return 24;
    if (svcType === "premium") return 48;
    return 72;
  }

  const orderRowsBulk: typeof orders.$inferInsert[] = [];
  const allOrderMeta: Array<{
    customerIdx: number;
    status: Status;
    payStatus: PayStatus;
    svcType: SvcType;
    price: number;
    discount: number;
    extraCharge: number;
    amountPaid: number;
    shirts: number;
    trousers: number;
    createdAt: Date;
    workerIdx: number | null;
    processingDueAt: Date;
    itemSpecs: Array<{ svcName: string; qty: number }>;
    orderId: string;
  }> = [];

  for (let i = 0; i < 200; i++) {
    const cust = insertedCustomers[i % insertedCustomers.length];
    const status: Status = rnd(STATUS_DIST);
    const svcType: SvcType = rnd(SVC_DIST);
    const daysBack = rndInt(0, 90);
    const createdAt = daysAgo(daysBack);
    const turnaround = slaHours(svcType);

    // Determine SLA due date:
    // - pending/processing: some overdue, some due soon, some fine
    // - ready/pickup/completed: already past due (realistic)
    let processingDueAt: Date;
    if (status === "pending" || status === "processing") {
      const r = Math.random();
      if (r < 0.15) {
        // Overdue
        processingDueAt = hoursAgo(rndInt(2, 72));
      } else if (r < 0.30) {
        // Due soon (within 24h)
        processingDueAt = hoursFromNow(rndInt(1, 20));
      } else {
        processingDueAt = new Date(createdAt.getTime() + turnaround * 3600000);
      }
    } else {
      processingDueAt = new Date(createdAt.getTime() + turnaround * 3600000);
    }

    // Random items (1-4 service types per order)
    const numItemTypes = rndInt(1, 4);
    const chosenSvcs = [...svcNames].sort(() => Math.random() - 0.5).slice(0, numItemTypes);
    const itemSpecs = chosenSvcs.map(svcName => ({
      svcName,
      qty: rndInt(1, svcName.includes("Rug") || svcName.includes("Duvet") || svcName.includes("Agbada") ? 2 : 6),
    }));

    const basePrice = itemSpecs.reduce((sum, { svcName, qty }) => sum + getPrice(svcName, svcType) * qty, 0);

    // Discounts & surcharges
    let discount = 0;
    let extraCharge = 0;
    if (Math.random() < 0.15 && basePrice > 1000) {
      discount = Math.round(basePrice * rndFloat(0.03, 0.15) / 100) * 100;
    }
    if (Math.random() < 0.1) {
      extraCharge = rnd([200, 300, 500, 750, 1000]);
    }

    const totalDue = basePrice + extraCharge - discount;

    // Payment status logic tied to order status
    let payStatus: PayStatus;
    let amountPaid: number;
    if (status === "completed") {
      payStatus = Math.random() < 0.85 ? "paid" : "partial";
    } else if (status === "ready" || status === "partial_pickup") {
      const r = Math.random();
      if (r < 0.5) payStatus = "paid";
      else if (r < 0.8) payStatus = "partial";
      else payStatus = "unpaid";
    } else {
      const r = Math.random();
      if (r < 0.3) payStatus = "partial";
      else payStatus = "unpaid";
    }

    if (payStatus === "paid") {
      amountPaid = totalDue;
    } else if (payStatus === "partial") {
      amountPaid = Math.round(totalDue * rndFloat(0.2, 0.7) / 100) * 100;
    } else {
      amountPaid = 0;
    }

    const shirts = itemSpecs.some(i => i.svcName === "Shirt") ? itemSpecs.find(i => i.svcName === "Shirt")!.qty : 0;
    const trousers = itemSpecs.some(i => i.svcName === "Trouser") ? itemSpecs.find(i => i.svcName === "Trouser")!.qty : 0;

    const workerIdx: number | null = (status !== "pending" && Math.random() > 0.1)
      ? rndInt(0, createdWorkers.length - 1) : null;

    const ordId = generateOrderId() + i.toString().padStart(3, "0");

    orderRowsBulk.push({
      laundryId,
      customerId: cust.id,
      orderId: ordId,
      customerName: cust.fullName,
      phone: cust.phone,
      address: cust.address,
      serviceType: svcType,
      shirts,
      trousers,
      status,
      paymentStatus: payStatus,
      price: basePrice.toString(),
      discount: discount > 0 ? discount.toString() : null,
      extraCharge: extraCharge > 0 ? extraCharge.toString() : null,
      amountPaid: amountPaid.toString(),
      assignedWorkerId: workerIdx !== null ? createdWorkers[workerIdx].id : null,
      processingDueAt,
      isVerified: status !== "pending" && Math.random() > 0.3,
      createdAt,
      updatedAt: new Date(createdAt.getTime() + rndInt(1, 12) * 3600000),
    });

    allOrderMeta.push({
      customerIdx: insertedCustomers.indexOf(cust),
      status,
      payStatus,
      svcType,
      price: basePrice,
      discount,
      extraCharge,
      amountPaid,
      shirts,
      trousers,
      createdAt,
      workerIdx,
      processingDueAt,
      itemSpecs,
      orderId: ordId,
    });
  }

  const insertedOrders = await db.insert(orders).values(orderRowsBulk).returning();
  console.log(`  ✅ ${insertedOrders.length} orders inserted`);

  // ─── Order Items ──────────────────────────────────────────────────────────
  console.log("  · Building order items...");
  const itemRowsBulk: typeof orderItems.$inferInsert[] = [];
  for (let i = 0; i < insertedOrders.length; i++) {
    const ord = insertedOrders[i];
    const meta = allOrderMeta[i];
    for (const { svcName, qty } of meta.itemSpecs) {
      const unitPrice = getPrice(svcName, meta.svcType);
      itemRowsBulk.push({
        orderId: ord.id,
        serviceId: createdSvcs[svcName].id,
        serviceType: meta.svcType,
        name: svcName,
        quantity: qty,
        quantityPickedUp: 0,
        unitPrice: unitPrice.toString(),
        totalPrice: (unitPrice * qty).toString(),
      });
    }
  }
  await db.insert(orderItems).values(itemRowsBulk);
  console.log(`  ✅ ${itemRowsBulk.length} order items`);

  // ─── Payment Records ──────────────────────────────────────────────────────
  console.log("  · Building payment records...");
  const paymentRowsBulk: typeof paymentRecords.$inferInsert[] = [];
  const METHODS = ["cash", "transfer", "pos"] as const;

  for (let i = 0; i < insertedOrders.length; i++) {
    const ord = insertedOrders[i];
    const meta = allOrderMeta[i];
    if (meta.amountPaid <= 0) continue;

    const totalDue = meta.price + meta.extraCharge - meta.discount;
    const worker = meta.workerIdx !== null ? createdWorkers[meta.workerIdx] : null;

    if (meta.payStatus === "paid") {
      // Single full payment 70% of time, split payment 30%
      if (Math.random() < 0.7) {
        paymentRowsBulk.push({
          orderId: ord.id,
          amount: meta.amountPaid.toString(),
          method: rnd(METHODS),
          remainingBalance: "0",
          recordedBy: worker ? worker.name : "Owner",
          workerId: worker ? worker.id : null,
          notes: Math.random() > 0.6 ? rnd(["Full payment", "Payment on collection", "Bank alert confirmed"]) : null,
          recordedAt: new Date(meta.createdAt.getTime() + rndInt(1, 48) * 3600000),
        });
      } else {
        // Split into 2 payments
        const first = Math.round(meta.amountPaid * rndFloat(0.4, 0.7) / 100) * 100;
        const second = meta.amountPaid - first;
        paymentRowsBulk.push({
          orderId: ord.id,
          amount: first.toString(),
          method: rnd(METHODS),
          remainingBalance: (totalDue - first).toString(),
          recordedBy: worker ? worker.name : "Owner",
          workerId: worker ? worker.id : null,
          notes: "First payment",
          recordedAt: new Date(meta.createdAt.getTime() + rndInt(1, 24) * 3600000),
        });
        paymentRowsBulk.push({
          orderId: ord.id,
          amount: second.toString(),
          method: rnd(METHODS),
          remainingBalance: "0",
          recordedBy: worker ? worker.name : "Owner",
          workerId: worker ? worker.id : null,
          notes: "Balance payment",
          recordedAt: new Date(meta.createdAt.getTime() + rndInt(25, 72) * 3600000),
        });
      }
    } else if (meta.payStatus === "partial") {
      const remaining = totalDue - meta.amountPaid;
      paymentRowsBulk.push({
        orderId: ord.id,
        amount: meta.amountPaid.toString(),
        method: rnd(METHODS),
        remainingBalance: remaining.toString(),
        recordedBy: worker ? worker.name : "Owner",
        workerId: worker ? worker.id : null,
        notes: Math.random() > 0.5 ? "Partial payment — balance on delivery" : null,
        recordedAt: new Date(meta.createdAt.getTime() + rndInt(1, 36) * 3600000),
      });
    }
  }
  if (paymentRowsBulk.length > 0) {
    await db.insert(paymentRecords).values(paymentRowsBulk);
  }
  console.log(`  ✅ ${paymentRowsBulk.length} payment records`);

  // ─── Pickup Records (for ready/partial_pickup/completed) ──────────────────
  console.log("  · Building pickup records...");
  const pickupRowsBulk: typeof pickupRecords.$inferInsert[] = [];

  for (let i = 0; i < insertedOrders.length; i++) {
    const ord = insertedOrders[i];
    const meta = allOrderMeta[i];
    if (!["partial_pickup", "completed"].includes(meta.status)) continue;

    const worker = meta.workerIdx !== null ? createdWorkers[meta.workerIdx] : null;
    const pickupAt = new Date(meta.createdAt.getTime() + rndInt(48, 96) * 3600000);

    // Build item pickups for this order
    const orderItemsForOrder = itemRowsBulk.filter(ir => {
      const idx = itemRowsBulk.indexOf(ir);
      const ordIdx = Math.floor(idx / (itemRowsBulk.length / insertedOrders.length));
      return ir.orderId === ord.id;
    });

    const shirts = meta.shirts;
    const trousers = meta.trousers;

    if (meta.status === "completed") {
      pickupRowsBulk.push({
        laundryId,
        orderId: ord.id,
        shirtsPickedUp: shirts,
        trousersPickedUp: trousers,
        notes: Math.random() > 0.6 ? "All items collected" : null,
        processedBy: worker ? worker.id : null,
        createdAt: pickupAt,
      });
      // Update quantityPickedUp inline (will be set after)
    } else if (meta.status === "partial_pickup") {
      const partialShirts = shirts > 0 ? rndInt(1, Math.max(1, shirts - 1)) : 0;
      const partialTrousers = trousers > 0 ? Math.random() > 0.5 ? rndInt(1, Math.max(1, trousers - 1)) : 0 : 0;
      pickupRowsBulk.push({
        laundryId,
        orderId: ord.id,
        shirtsPickedUp: partialShirts,
        trousersPickedUp: partialTrousers,
        notes: "Partial collection — customer to return",
        processedBy: worker ? worker.id : null,
        createdAt: pickupAt,
      });
    }
  }
  if (pickupRowsBulk.length > 0) {
    await db.insert(pickupRecords).values(pickupRowsBulk);
  }
  console.log(`  ✅ ${pickupRowsBulk.length} pickup records`);

  // ─── Discount Approvals ───────────────────────────────────────────────────
  console.log("  · Building discount approvals...");
  const discountRows: typeof discountApprovals.$inferInsert[] = [];
  const discountAuditRows: typeof auditLog.$inferInsert[] = [];

  // Pick ~30 random orders for discount requests
  const discountOrderIndices = [...Array(200).keys()]
    .sort(() => Math.random() - 0.5)
    .slice(0, 30);

  for (const idx of discountOrderIndices) {
    const ord = insertedOrders[idx];
    const meta = allOrderMeta[idx];
    const worker = rnd(createdWorkers);
    const discountAmt = Math.round(meta.price * rndFloat(0.05, 0.18) / 100) * 100 + 200;
    const reasons = [
      "Customer is a regular — requested loyalty discount",
      "Customer complained about delay — goodwill discount",
      "Family of 3 brought large order — bulk discount",
      "Long-standing customer with referrals",
      "Damage during processing — compensation discount",
      "Customer paid in full upfront — discount reward",
    ];

    const r = Math.random();
    const status: "pending" | "approved" | "rejected" = r < 0.33 ? "pending" : r < 0.66 ? "approved" : "rejected";

    const createdAtDA = new Date(meta.createdAt.getTime() + rndInt(1, 12) * 3600000);

    discountRows.push({
      laundryId,
      orderId: ord.id,
      requestedBy: worker.id,
      requestedByName: worker.name,
      originalAmount: meta.price.toString(),
      requestedDiscount: discountAmt.toString(),
      reason: rnd(reasons),
      status,
      resolvedBy: status !== "pending" ? "Owner" : null,
      resolvedAt: status !== "pending" ? new Date(createdAtDA.getTime() + rndInt(1, 8) * 3600000) : null,
      createdAt: createdAtDA,
    });

    // Audit log for discount request
    discountAuditRows.push({
      laundryId,
      actorId: worker.id,
      actorType: "worker",
      actorName: worker.name,
      action: "discount_requested",
      orderId: ord.id,
      metadata: { amount: discountAmt, reason: rnd(reasons), orderId: ord.orderId },
      createdAt: createdAtDA,
    });

    if (status === "approved") {
      discountAuditRows.push({
        laundryId,
        actorId: null,
        actorType: "owner",
        actorName: "Owner",
        action: "discount_approved",
        orderId: ord.id,
        metadata: { discountAmount: discountAmt, requestedBy: worker.name, orderId: ord.orderId },
        createdAt: new Date(createdAtDA.getTime() + rndInt(1, 8) * 3600000),
      });
    } else if (status === "rejected") {
      discountAuditRows.push({
        laundryId,
        actorId: null,
        actorType: "owner",
        actorName: "Owner",
        action: "discount_rejected",
        orderId: ord.id,
        metadata: { requestedDiscount: discountAmt, requestedBy: worker.name, orderId: ord.orderId },
        createdAt: new Date(createdAtDA.getTime() + rndInt(1, 8) * 3600000),
      });
    }
  }

  await db.insert(discountApprovals).values(discountRows);
  console.log(`  ✅ ${discountRows.filter(d => d.status === "pending").length} pending, ${discountRows.filter(d => d.status === "approved").length} approved, ${discountRows.filter(d => d.status === "rejected").length} rejected discount requests`);

  // ─── Audit Log ────────────────────────────────────────────────────────────
  console.log("  · Building audit log entries...");
  const auditRows: typeof auditLog.$inferInsert[] = [];

  for (let i = 0; i < insertedOrders.length; i++) {
    const ord = insertedOrders[i];
    const meta = allOrderMeta[i];
    const worker = meta.workerIdx !== null ? createdWorkers[meta.workerIdx] : null;

    // order_created
    auditRows.push({
      laundryId,
      actorId: null,
      actorType: "owner",
      actorName: "Owner",
      action: "order_created",
      orderId: ord.id,
      metadata: { orderId: ord.orderId, customerName: meta.orderId, serviceType: meta.svcType, price: meta.price },
      createdAt: meta.createdAt,
    });

    // Worker assignment
    if (worker) {
      auditRows.push({
        laundryId,
        actorId: null,
        actorType: "owner",
        actorName: "Owner",
        action: "order_updated",
        orderId: ord.id,
        metadata: { changes: { assignedWorkerId: worker.id }, orderId: ord.orderId },
        createdAt: new Date(meta.createdAt.getTime() + rndInt(10, 60) * 60000),
      });
    }

    // Status progression for processing+
    if (["processing", "ready", "partial_pickup", "completed"].includes(meta.status)) {
      const actor = worker ?? { name: "Owner", id: null };
      auditRows.push({
        laundryId,
        actorId: worker ? worker.id : null,
        actorType: worker ? "worker" : "owner",
        actorName: actor.name,
        action: "order_updated",
        orderId: ord.id,
        metadata: { changes: { status: "processing" }, orderId: ord.orderId },
        createdAt: new Date(meta.createdAt.getTime() + rndInt(1, 4) * 3600000),
      });
    }

    if (["ready", "partial_pickup", "completed"].includes(meta.status)) {
      auditRows.push({
        laundryId,
        actorId: worker ? worker.id : null,
        actorType: worker ? "worker" : "owner",
        actorName: worker ? worker.name : "Owner",
        action: "order_updated",
        orderId: ord.id,
        metadata: { changes: { status: "ready" }, orderId: ord.orderId },
        createdAt: new Date(meta.createdAt.getTime() + rndInt(12, 48) * 3600000),
      });
    }

    // Payment entries
    if (meta.amountPaid > 0) {
      const totalDue = meta.price + meta.extraCharge - meta.discount;
      auditRows.push({
        laundryId,
        actorId: worker ? worker.id : null,
        actorType: worker ? "worker" : "owner",
        actorName: worker ? worker.name : "Owner",
        action: "payment_recorded",
        orderId: ord.id,
        metadata: {
          amount: meta.amountPaid,
          method: rnd(["cash", "transfer", "pos"]),
          remainingBalance: Math.max(0, totalDue - meta.amountPaid),
          orderId: ord.orderId,
        },
        createdAt: new Date(meta.createdAt.getTime() + rndInt(2, 24) * 3600000),
      });
    }

    // Discount audit entries
    if (meta.discount > 0 && !discountOrderIndices.includes(i)) {
      auditRows.push({
        laundryId,
        actorId: null,
        actorType: "owner",
        actorName: "Owner",
        action: "discount_applied",
        orderId: ord.id,
        metadata: { amount: meta.discount, reason: "Loyalty/VIP discount", orderId: ord.orderId },
        createdAt: new Date(meta.createdAt.getTime() + rndInt(1, 6) * 3600000),
      });
    }
  }

  // Add discount audit rows
  auditRows.push(...discountAuditRows);

  // Batch insert in chunks of 200
  const CHUNK = 200;
  for (let i = 0; i < auditRows.length; i += CHUNK) {
    await db.insert(auditLog).values(auditRows.slice(i, i + CHUNK));
  }
  console.log(`  ✅ ${auditRows.length} audit log entries`);

  // ─── Notifications ────────────────────────────────────────────────────────
  console.log("  · Building notifications...");
  const notifRows: typeof notifications.$inferInsert[] = [];

  for (let i = 0; i < insertedOrders.length; i++) {
    const ord = insertedOrders[i];
    const meta = allOrderMeta[i];

    // new_order notification for every order
    notifRows.push({
      laundryId,
      targetType: "owner",
      eventType: "new_order",
      title: "New Order Received",
      message: `Order #${ord.orderId} for ${ord.customerName} (${meta.svcType}) received.`,
      severity: "info",
      relatedOrderId: ord.id,
      isRead: Math.random() > 0.3,
      createdAt: meta.createdAt,
    });

    if (meta.status === "ready" || meta.status === "partial_pickup" || meta.status === "completed") {
      notifRows.push({
        laundryId,
        targetType: "owner",
        eventType: "order_ready",
        title: "Order Ready for Pickup",
        message: `Order #${ord.orderId} for ${ord.customerName} is ready for pickup.`,
        severity: "success",
        relatedOrderId: ord.id,
        isRead: Math.random() > 0.4,
        createdAt: new Date(meta.createdAt.getTime() + rndInt(12, 48) * 3600000),
      });
    }

    if (meta.amountPaid > 0) {
      const totalDue = meta.price + meta.extraCharge - meta.discount;
      const remaining = totalDue - meta.amountPaid;
      notifRows.push({
        laundryId,
        targetType: "owner",
        eventType: "payment_received",
        title: "Payment Received",
        message: `₦${meta.amountPaid.toLocaleString()} for Order #${ord.orderId}. Balance: ₦${remaining.toLocaleString()}.`,
        severity: remaining <= 0 ? "success" : "info",
        relatedOrderId: ord.id,
        isRead: Math.random() > 0.5,
        createdAt: new Date(meta.createdAt.getTime() + rndInt(2, 24) * 3600000),
      });
    }
  }

  // Overdue/due-soon notifications
  for (let i = 0; i < insertedOrders.length; i++) {
    const ord = insertedOrders[i];
    const meta = allOrderMeta[i];
    if (!["pending", "processing"].includes(meta.status)) continue;
    const now = Date.now();
    const dueMs = meta.processingDueAt.getTime();
    if (dueMs < now) {
      notifRows.push({
        laundryId,
        targetType: "owner",
        eventType: "overdue",
        title: "Order Overdue",
        message: `Order #${ord.orderId} for ${ord.customerName} is past its deadline.`,
        severity: "urgent",
        relatedOrderId: ord.id,
        isRead: false,
        createdAt: meta.processingDueAt,
      });
    } else if (dueMs - now < 24 * 3600000) {
      notifRows.push({
        laundryId,
        targetType: "owner",
        eventType: "due_soon",
        title: "Order Due Soon",
        message: `Order #${ord.orderId} for ${ord.customerName} is due within 24 hours.`,
        severity: "warning",
        relatedOrderId: ord.id,
        isRead: false,
        createdAt: new Date(),
      });
    }
  }

  // Pending discount notifications
  for (const dr of discountRows) {
    if (dr.status === "pending") {
      notifRows.push({
        laundryId,
        targetType: "owner",
        eventType: "discount_requested" as any,
        title: "Discount Approval Required",
        message: `${dr.requestedByName} requested ₦${Number(dr.requestedDiscount).toLocaleString()} discount. Reason: ${dr.reason}`,
        severity: "warning",
        relatedOrderId: dr.orderId,
        isRead: false,
        createdAt: dr.createdAt as Date,
      });
    }
  }

  const NOTIF_CHUNK = 200;
  for (let i = 0; i < notifRows.length; i += NOTIF_CHUNK) {
    await db.insert(notifications).values(notifRows.slice(i, i + NOTIF_CHUNK));
  }
  console.log(`  ✅ ${notifRows.length} notifications`);

  // ─── Update Customer lastActivityAt ───────────────────────────────────────
  console.log("  · Updating customer last activity...");
  for (const cust of insertedCustomers) {
    const custOrders = insertedOrders.filter(o => o.customerId === cust.id);
    if (custOrders.length === 0) continue;
    const latest = custOrders.reduce((a, b) =>
      new Date(a.createdAt!).getTime() > new Date(b.createdAt!).getTime() ? a : b
    );
    await db.update(customers)
      .set({ lastActivityAt: latest.createdAt as Date })
      .where(eq(customers.id, cust.id));
  }
  console.log("  ✅ Customer activity timestamps updated");

  // ─── Expenditures ─────────────────────────────────────────────────────────
  console.log("\n💰 Creating expenditures...");
  const { expenditures } = await import("@workspace/db/schema");
  const expRows: typeof expenditures.$inferInsert[] = [];
  const EXP_CATEGORIES = ["electricity", "detergent", "water", "salaries", "transport", "maintenance", "packaging", "miscellaneous"] as const;

  for (let m = 0; m < 3; m++) {
    const monthStart = new Date();
    monthStart.setMonth(monthStart.getMonth() - m);
    monthStart.setDate(1);

    expRows.push(
      { laundryId, category: "electricity", amount: rndInt(15000, 35000).toString(), notes: `Month ${m + 1} electricity`, isRecurring: true, createdAt: new Date(monthStart.getTime() + rndInt(1, 5) * 86400000) },
      { laundryId, category: "detergent", amount: rndInt(8000, 20000).toString(), notes: "Washing detergents & fabric softener", isRecurring: false, createdAt: new Date(monthStart.getTime() + rndInt(3, 10) * 86400000) },
      { laundryId, category: "water", amount: rndInt(5000, 12000).toString(), notes: "Water supply", isRecurring: true, createdAt: new Date(monthStart.getTime() + rndInt(5, 15) * 86400000) },
      { laundryId, category: "salaries", amount: rndInt(80000, 150000).toString(), notes: "Worker salaries", isRecurring: true, createdAt: new Date(monthStart.getTime() + rndInt(25, 30) * 86400000) },
      { laundryId, category: "packaging", amount: rndInt(3000, 8000).toString(), notes: "Plastic bags, hangers, wrapping", isRecurring: false, createdAt: new Date(monthStart.getTime() + rndInt(8, 20) * 86400000) },
    );

    if (Math.random() > 0.4) {
      expRows.push({ laundryId, category: "maintenance", amount: rndInt(5000, 25000).toString(), notes: "Machine maintenance / repairs", isRecurring: false, createdAt: new Date(monthStart.getTime() + rndInt(10, 25) * 86400000) });
    }
    if (Math.random() > 0.5) {
      expRows.push({ laundryId, category: "transport", amount: rndInt(2000, 8000).toString(), notes: "Delivery transport costs", isRecurring: false, createdAt: new Date(monthStart.getTime() + rndInt(5, 28) * 86400000) });
    }
    if (Math.random() > 0.6) {
      expRows.push({ laundryId, category: "miscellaneous", amount: rndInt(1000, 5000).toString(), notes: "Miscellaneous operational costs", isRecurring: false, createdAt: new Date(monthStart.getTime() + rndInt(15, 28) * 86400000) });
    }
  }

  await db.insert(expenditures).values(expRows);
  console.log(`✅ ${expRows.length} expenditure records across 3 months\n`);

  // ─── Final Stats ──────────────────────────────────────────────────────────
  const statuses = {
    pending: insertedOrders.filter(o => o.status === "pending").length,
    processing: insertedOrders.filter(o => o.status === "processing").length,
    ready: insertedOrders.filter(o => o.status === "ready").length,
    partial_pickup: insertedOrders.filter(o => o.status === "partial_pickup").length,
    completed: insertedOrders.filter(o => o.status === "completed").length,
  };
  const payments = {
    unpaid: insertedOrders.filter(o => o.paymentStatus === "unpaid").length,
    partial: insertedOrders.filter(o => o.paymentStatus === "partial").length,
    paid: insertedOrders.filter(o => o.paymentStatus === "paid").length,
  };
  const svcBreakdown = {
    standard: allOrderMeta.filter(m => m.svcType === "standard").length,
    express: allOrderMeta.filter(m => m.svcType === "express").length,
    premium: allOrderMeta.filter(m => m.svcType === "premium").length,
  };
  const totalRevenue = allOrderMeta.reduce((s, m) => s + m.price + m.extraCharge - m.discount, 0);
  const collectedRevenue = allOrderMeta.reduce((s, m) => s + m.amountPaid, 0);

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║                 STRESS TEST COMPLETE ✅                   ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");
  console.log("📋 CREDENTIALS:");
  console.log("   Owner:           owner@test.com / password123");
  for (const w of createdWorkers) {
    const wd = workerDefs.find(d => d.name === w.name)!;
    console.log(`   ${w.role === "admin" ? "Admin " : ""}Worker (${w.name}): phone ${wd.phone}, PIN ${wd.pin}`);
  }
  console.log("\n📊 GENERATED DATA:");
  console.log(`   Customers:        ${insertedCustomers.length}`);
  console.log(`   Orders:           ${insertedOrders.length}`);
  console.log(`   Order Items:      ${itemRowsBulk.length}`);
  console.log(`   Payments:         ${paymentRowsBulk.length}`);
  console.log(`   Pickups:          ${pickupRowsBulk.length}`);
  console.log(`   Discount Requests:${discountRows.length} (${discountRows.filter(d => d.status === "pending").length}P / ${discountRows.filter(d => d.status === "approved").length}A / ${discountRows.filter(d => d.status === "rejected").length}R)`);
  console.log(`   Audit Entries:    ${auditRows.length}`);
  console.log(`   Notifications:    ${notifRows.length}`);
  console.log(`   Expenditures:     ${expRows.length}`);
  console.log("\n📦 ORDER STATUS BREAKDOWN:");
  console.log(`   Pending:          ${statuses.pending}`);
  console.log(`   Processing:       ${statuses.processing}`);
  console.log(`   Ready:            ${statuses.ready}`);
  console.log(`   Partial Pickup:   ${statuses.partial_pickup}`);
  console.log(`   Completed:        ${statuses.completed}`);
  console.log("\n💳 PAYMENT BREAKDOWN:");
  console.log(`   Unpaid:           ${payments.unpaid}`);
  console.log(`   Partial:          ${payments.partial}`);
  console.log(`   Paid:             ${payments.paid}`);
  console.log("\n🧺 SERVICE TYPE BREAKDOWN:");
  console.log(`   Standard:         ${svcBreakdown.standard}`);
  console.log(`   Express:          ${svcBreakdown.express}`);
  console.log(`   Premium:          ${svcBreakdown.premium}`);
  console.log("\n💰 FINANCIALS:");
  console.log(`   Total Revenue:    ₦${totalRevenue.toLocaleString()}`);
  console.log(`   Collected:        ₦${collectedRevenue.toLocaleString()}`);
  console.log(`   Outstanding:      ₦${(totalRevenue - collectedRevenue).toLocaleString()}`);
  console.log(`   Collection Rate:  ${((collectedRevenue / totalRevenue) * 100).toFixed(1)}%`);
}

main().catch(e => {
  console.error("\n❌ Seed failed:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
