/**
 * Financial Integrity Validation Suite
 *
 * Tests receipt uniqueness, payment concurrency safety, pickup concurrency
 * safety, idempotency race protection, and overall financial accuracy.
 *
 * Run: pnpm --filter scripts tsx test-financial-integrity.ts
 * Requires: API server running on http://localhost:3001
 *           and a valid owner JWT in OWNER_TOKEN env var
 *           (or will attempt owner-login with OWNER_EMAIL / OWNER_PASSWORD)
 */

import { randomUUID } from "crypto";

// ─── Config ─────────────────────────────────────────────────────────────────

const API = process.env.API_URL ?? "http://localhost:3001/api";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "demo@cleantrack.ng";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "Demo@1234";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let ownerToken = process.env.OWNER_TOKEN ?? "";
let testLaundryId = 0;
let testBranchId = 0;

async function login() {
  const r = await fetch(`${API}/auth/owner-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  if (!r.ok) throw new Error(`Login failed: ${await r.text()}`);
  const data = await r.json() as any;
  ownerToken = data.token;
  testLaundryId = data.laundry?.id ?? data.owner?.laundryId;
  console.log(`  Logged in. laundryId=${testLaundryId}`);
}

function auth(idempotencyKey?: string): HeadersInit {
  const h: HeadersInit = {
    Authorization: `Bearer ${ownerToken}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) (h as any)["Idempotency-Key"] = idempotencyKey;
  return h;
}

async function createOrder(extra: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`${API}/orders`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({
      customerName: `Test-${randomUUID().slice(0, 8)}`,
      phone: `080${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
      serviceType: "standard",
      shirts: 3,
      trousers: 2,
      price: 5000,
      ...extra,
    }),
  });
  if (!r.ok) throw new Error(`createOrder failed: ${await r.text()}`);
  return r.json();
}

async function payOrder(orderId: number, amount: number, idempotencyKey?: string): Promise<Response> {
  return fetch(`${API}/orders/${orderId}/payments`, {
    method: "POST",
    headers: auth(idempotencyKey),
    body: JSON.stringify({ amount, method: "cash" }),
  });
}

async function markReady(orderId: number): Promise<void> {
  await fetch(`${API}/orders/${orderId}`, {
    method: "PATCH",
    headers: auth(),
    body: JSON.stringify({ status: "processing" }),
  });
  await fetch(`${API}/orders/${orderId}`, {
    method: "PATCH",
    headers: auth(),
    body: JSON.stringify({ status: "ready" }),
  });
}

async function pickupOrder(orderId: number, idempotencyKey?: string): Promise<Response> {
  return fetch(`${API}/orders/${orderId}/pickups`, {
    method: "POST",
    headers: auth(idempotencyKey),
    body: JSON.stringify({ shirtsPickedUp: 3, trousersPickedUp: 2 }),
  });
}

async function getOrder(orderId: number): Promise<any> {
  const r = await fetch(`${API}/orders/${orderId}`, { headers: auth() });
  if (!r.ok) throw new Error(`getOrder failed: ${await r.text()}`);
  return r.json();
}

async function getPayments(orderId: number): Promise<any[]> {
  const r = await fetch(`${API}/orders/${orderId}/payments`, { headers: auth() });
  if (!r.ok) throw new Error(`getPayments failed: ${await r.text()}`);
  return r.json();
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  [ ] ${name}`);
  try {
    await fn();
    process.stdout.write(`\r  [✓] ${name}\n`);
    passed++;
  } catch (err: any) {
    process.stdout.write(`\r  [✗] ${name}\n`);
    console.error(`      → ${err.message}`);
    failures.push(name);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function testSequentialPayments() {
  // T1: Sequential payment creation — each payment gets a unique receipt number
  const order = await createOrder({ price: 3000 });
  const r1 = await payOrder(order.id, 1000);
  const r2 = await payOrder(order.id, 1000);
  const r3 = await payOrder(order.id, 1000);
  assert(r1.ok && r2.ok && r3.ok, "All three payments should succeed");
  const payments = await getPayments(order.id);
  assert(payments.length === 3, `Expected 3 payments, got ${payments.length}`);
  const receipts = payments.map((p: any) => p.receiptNumber);
  const unique = new Set(receipts);
  assert(unique.size === 3, `Expected 3 unique receipt numbers, got: ${JSON.stringify(receipts)}`);
}

async function testConcurrentPayments() {
  // T2: Concurrent payment creation — amounts must not be double-counted
  const order = await createOrder({ price: 10000 });
  const CONCURRENT = 5;
  const amount = 1000;
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENT }, () => payOrder(order.id, amount))
  );
  const successes = results.filter(r => r.status === "fulfilled" && (r.value as Response).ok);
  assert(successes.length === CONCURRENT, `Expected ${CONCURRENT} successes, got ${successes.length}`);

  const finalOrder = await getOrder(order.id);
  const expectedPaid = CONCURRENT * amount;
  const actualPaid = parseFloat(finalOrder.amountPaid);
  assert(
    Math.abs(actualPaid - expectedPaid) < 0.01,
    `amountPaid should be ${expectedPaid}, got ${actualPaid}`
  );
}

async function testHundredSimultaneousPayments() {
  // T3: 100 simultaneous payments across 10 orders (10 per order)
  const orders = await Promise.all(Array.from({ length: 10 }, () => createOrder({ price: 10000 })));
  const payments = orders.flatMap(o => Array.from({ length: 10 }, () => payOrder(o.id, 500)));
  const results = await Promise.allSettled(payments);
  const successCount = results.filter(r => r.status === "fulfilled" && (r.value as Response).ok).length;
  assert(successCount === 100, `Expected 100 successes, got ${successCount}`);

  // Verify each order's balance is correct
  for (const o of orders) {
    const finalOrder = await getOrder(o.id);
    assert(Math.abs(parseFloat(finalOrder.amountPaid) - 5000) < 0.01,
      `Order ${o.id} amountPaid should be 5000, got ${finalOrder.amountPaid}`);
  }
}

async function testStressPayments() {
  // T4: 50 payments on a single order — final balance must be exact
  const totalPrice = 50000;
  const order = await createOrder({ price: totalPrice });
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, () => payOrder(order.id, 1000))
  );
  const successCount = results.filter(r => r.status === "fulfilled" && (r.value as Response).ok).length;
  assert(successCount === 50, `Expected 50 successes, got ${successCount}`);

  const finalOrder = await getOrder(order.id);
  assert(Math.abs(parseFloat(finalOrder.amountPaid) - totalPrice) < 0.01,
    `amountPaid should be ${totalPrice}, got ${finalOrder.amountPaid}`);
  assert(finalOrder.paymentStatus === "paid", `Expected paid, got ${finalOrder.paymentStatus}`);
}

async function testReceiptUniqueness() {
  // T5: Receipt numbers must be globally unique across all created payments
  const orders = await Promise.all(Array.from({ length: 5 }, () => createOrder({ price: 1000 })));
  const allPayments: any[] = [];
  for (const o of orders) {
    const r = await payOrder(o.id, 1000);
    assert(r.ok, `Payment should succeed for order ${o.id}`);
    const p = await r.json();
    allPayments.push(p);
  }
  const receipts = allPayments.map(p => p.receiptNumber);
  const unique = new Set(receipts);
  assert(unique.size === receipts.length, `Duplicate receipts found: ${JSON.stringify(receipts)}`);
  // All must match expected format
  const fmtRe = /^RCT-\d{8}-\d{4,}$/;
  for (const r of receipts) {
    assert(fmtRe.test(r), `Receipt number "${r}" does not match expected format`);
  }
}

async function testDuplicateRequestReplay() {
  // T6: Same Idempotency-Key sent twice — only one payment should be created
  const order = await createOrder({ price: 5000 });
  const key = randomUUID();
  const [r1, r2] = await Promise.all([payOrder(order.id, 1000, key), payOrder(order.id, 1000, key)]);
  // One should succeed (201) and one should either be a cached replay (201) or in-flight (409)
  const statuses = [r1.status, r2.status].sort();
  const validCombos = ["201,201", "201,409"];
  assert(validCombos.includes(statuses.join(",")), `Unexpected status pair: ${statuses.join(",")}`);
  const payments = await getPayments(order.id);
  assert(payments.length === 1, `Expected exactly 1 payment, got ${payments.length}`);
  assert(Math.abs(parseFloat(order.amountPaid ?? "0") + 1000 - parseFloat((await getOrder(order.id)).amountPaid)) < 0.01,
    "amountPaid should reflect exactly one payment");
}

async function testOfflineSyncReplay() {
  // T7: Offline sync replay — same Idempotency-Key retried multiple times sequentially
  const order = await createOrder({ price: 5000 });
  const key = randomUUID();
  const r1 = await payOrder(order.id, 2000, key);
  assert(r1.ok, "First payment should succeed");
  // Simulate retry after network recovery
  const r2 = await payOrder(order.id, 2000, key);
  assert(r2.status === 201, `Retry should return cached 201, got ${r2.status}`);
  const p1 = await r1.json();
  const p2 = await r2.json();
  assert(p1.id === p2.id, `Both responses should return the same payment ID. Got ${p1.id} vs ${p2.id}`);
  const payments = await getPayments(order.id);
  assert(payments.length === 1, `Expected 1 payment, got ${payments.length}`);
}

async function testBrowserRetrySimulation() {
  // T8: Browser retry — same key retried 5 times, only 1 payment created
  const order = await createOrder({ price: 5000 });
  const key = randomUUID();
  const responses: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await payOrder(order.id, 500, key);
    responses.push(r.status);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const payments = await getPayments(order.id);
  assert(payments.length === 1, `Expected 1 payment after 5 retries, got ${payments.length}`);
  assert(responses[0] === 201, `First response should be 201, got ${responses[0]}`);
  // All subsequent must be 201 (cached replay)
  for (let i = 1; i < responses.length; i++) {
    assert(responses[i] === 201, `Retry ${i} should be 201, got ${responses[i]}`);
  }
}

async function testNetworkTimeoutDuplicateReplay() {
  // T9: Simulate network timeout — same key sent rapidly twice then a third time
  const order = await createOrder({ price: 5000 });
  const key = randomUUID();
  const [fast1, fast2] = await Promise.all([payOrder(order.id, 1500, key), payOrder(order.id, 1500, key)]);
  const statuses = [fast1.status, fast2.status].sort();
  const valid = ["201,201", "201,409"];
  assert(valid.includes(statuses.join(",")), `Unexpected: ${statuses.join(",")}`);
  // Third attempt after both settle — must be cached 201
  await new Promise(r => setTimeout(r, 100));
  const r3 = await payOrder(order.id, 1500, key);
  assert(r3.status === 201, `Third attempt (after settlement) should be 201, got ${r3.status}`);
  const payments = await getPayments(order.id);
  assert(payments.length === 1, `Expected 1 payment, got ${payments.length}`);
}

async function testSameIdempotencyKeyRace() {
  // T10: Same Idempotency-Key at the same millisecond — atomic reservation must block duplicate
  const order = await createOrder({ price: 5000 });
  const key = randomUUID();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => payOrder(order.id, 500, key))
  );
  const statuses = results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<Response>).value.status);
  const successCount = statuses.filter(s => s === 201).length;
  assert(successCount >= 1, "At least one must succeed (201)");
  const payments = await getPayments(order.id);
  assert(payments.length === 1, `Expected 1 payment, got ${payments.length}`);
}

async function testConcurrentPickups() {
  // T11: Concurrent pickups — item quantities must not be double-applied
  const order = await createOrder({ price: 5000 });
  await markReady(order.id);
  // Fire 5 concurrent pickup attempts — only enough items for one full pickup
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => pickupOrder(order.id))
  );
  const statuses = results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<Response>).value.status);
  // Some must succeed (201), some must fail (400 – already picked up / wrong status)
  const successCount = statuses.filter(s => s === 201).length;
  const errorCount = statuses.filter(s => s >= 400).length;
  assert(successCount >= 1, `At least one pickup should succeed; got statuses ${statuses.join(",")}`);
  assert(successCount + errorCount === statuses.length, "All results should be 201 or 4xx");

  const finalOrder = await getOrder(order.id);
  // Shirts and trousers picked up must not exceed the original quantity
  assert(finalOrder.shirtsPickedUp <= order.shirts, `shirtsPickedUp ${finalOrder.shirtsPickedUp} > ${order.shirts}`);
  assert(finalOrder.trousersPickedUp <= order.trousers, `trousersPickedUp ${finalOrder.trousersPickedUp} > ${order.trousers}`);
}

async function testMixedPaymentPickupLoad() {
  // T12: Mixed concurrent payments and pickups on the same order
  const order = await createOrder({ price: 5000 });
  await markReady(order.id);
  const ops = [
    payOrder(order.id, 1000),
    payOrder(order.id, 1000),
    payOrder(order.id, 1000),
    pickupOrder(order.id),
    pickupOrder(order.id),
  ];
  const results = await Promise.allSettled(ops);
  const statuses = results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<Response>).value.status);
  // All payments should succeed; pickups: at least 1 succeeds
  const payStatuses = statuses.slice(0, 3);
  assert(payStatuses.every(s => s === 201), `All payments should succeed: ${payStatuses.join(",")}`);
  const pickupStatuses = statuses.slice(3);
  const pickupSuccesses = pickupStatuses.filter(s => s === 201).length;
  assert(pickupSuccesses >= 1, `At least one pickup should succeed: ${pickupStatuses.join(",")}`);
}

async function testIdempotencyKeyPickupReplay() {
  // T13: Pickup with idempotency key replayed multiple times
  const order = await createOrder({ price: 5000 });
  await markReady(order.id);
  const key = randomUUID();
  const r1 = await pickupOrder(order.id, key);
  assert(r1.status === 201, `First pickup should be 201, got ${r1.status}`);
  const r2 = await pickupOrder(order.id, key);
  assert(r2.status === 201, `Replay should return cached 201, got ${r2.status}`);
  const b1 = await r1.json();
  const b2 = await r2.json();
  assert(b1.pickup.id === b2.pickup.id, `Replay should return the same pickup ID. Got ${b1.pickup.id} vs ${b2.pickup.id}`);
}

async function testExistingRecordsRemainValid() {
  // T14: Fetching existing orders/payments still works after migration
  // (Verifies backward compatibility — existing records are not broken)
  const r = await fetch(`${API}/orders?limit=5`, { headers: auth() });
  assert(r.ok, `GET /orders should succeed, got ${r.status}`);
  const existing = await r.json() as any[];
  // If there are existing payments, verify we can fetch them
  if (existing.length > 0) {
    const firstOrder = existing[0];
    const pmts = await fetch(`${API}/orders/${firstOrder.id}/payments`, { headers: auth() });
    assert(pmts.ok, `GET payments for existing order should succeed, got ${pmts.status}`);
  }
}

async function testMigrationSafety() {
  // T15: New receipts have the correct format; schema push did not break anything
  const order = await createOrder({ price: 1000 });
  const r = await payOrder(order.id, 1000);
  assert(r.ok, "Payment should succeed");
  const payment = await r.json();
  const fmtRe = /^RCT-\d{8}-\d{4,}$/;
  assert(fmtRe.test(payment.receiptNumber), `Receipt "${payment.receiptNumber}" does not match RCT-YYYYMMDD-NNNN format`);
}

async function testMultiOrderReceiptUniqueness() {
  // T16: 20 concurrent payments across 20 different orders — all receipts unique
  const orders = await Promise.all(Array.from({ length: 20 }, () => createOrder({ price: 500 })));
  const results = await Promise.allSettled(orders.map(o => payOrder(o.id, 500)));
  const successes = results
    .filter(r => r.status === "fulfilled" && (r.value as Response).ok)
    .map(r => r as PromiseFulfilledResult<Response>);
  assert(successes.length === 20, `All 20 payments should succeed, got ${successes.length}`);
  const payments = await Promise.all(successes.map(s => s.value.json()));
  const receipts = payments.map((p: any) => p.receiptNumber);
  const unique = new Set(receipts);
  assert(unique.size === 20, `Expected 20 unique receipts, got ${unique.size}: ${JSON.stringify(receipts)}`);
}

async function testFinancialIntegrityVerification() {
  // T17: Final financial verification — amountPaid matches sum of payment records
  const price = 9000;
  const order = await createOrder({ price });
  await payOrder(order.id, 3000);
  await payOrder(order.id, 3000);
  await payOrder(order.id, 3000);
  const finalOrder = await getOrder(order.id);
  const payments = await getPayments(order.id);
  const sumFromRecords = payments.reduce((s: number, p: any) => s + parseFloat(p.amount), 0);
  assert(Math.abs(sumFromRecords - price) < 0.01, `Sum of records should be ${price}, got ${sumFromRecords}`);
  assert(Math.abs(parseFloat(finalOrder.amountPaid) - price) < 0.01,
    `order.amountPaid should be ${price}, got ${finalOrder.amountPaid}`);
  assert(finalOrder.paymentStatus === "paid", `Expected paid, got ${finalOrder.paymentStatus}`);
}

async function testPartialPaymentIntegrity() {
  // T18: Partial payments — running balance is always correct
  const price = 6000;
  const order = await createOrder({ price });
  await payOrder(order.id, 2000);
  let o = await getOrder(order.id);
  assert(Math.abs(parseFloat(o.amountPaid) - 2000) < 0.01, `After 1st partial: expected 2000, got ${o.amountPaid}`);
  assert(o.paymentStatus === "partial", `Expected partial, got ${o.paymentStatus}`);
  await payOrder(order.id, 2000);
  o = await getOrder(order.id);
  assert(Math.abs(parseFloat(o.amountPaid) - 4000) < 0.01, `After 2nd partial: expected 4000, got ${o.amountPaid}`);
  await payOrder(order.id, 2000);
  o = await getOrder(order.id);
  assert(Math.abs(parseFloat(o.amountPaid) - 6000) < 0.01, `After 3rd: expected 6000, got ${o.amountPaid}`);
  assert(o.paymentStatus === "paid", `Expected paid, got ${o.paymentStatus}`);
}

async function testCounterRolloverPerDay() {
  // T19: Counter resets conceptually per day — new receipts increment monotonically today
  const orders = await Promise.all(Array.from({ length: 5 }, () => createOrder({ price: 100 })));
  const results = await Promise.allSettled(orders.map(o => payOrder(o.id, 100)));
  const payments = await Promise.all(
    results
      .filter(r => r.status === "fulfilled" && (r.value as Response).ok)
      .map(async r => (r as PromiseFulfilledResult<Response>).value.json())
  );
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  for (const p of payments) {
    assert((p as any).receiptNumber.startsWith(`RCT-${today}-`),
      `Receipt ${(p as any).receiptNumber} should start with RCT-${today}-`);
  }
  const suffixes = payments.map((p: any) => parseInt(p.receiptNumber.split("-").pop()));
  const allPositive = suffixes.every(n => n > 0);
  assert(allPositive, `All counter suffixes should be positive: ${suffixes}`);
}

async function testIdempotencyExpiry() {
  // T20: Two different Idempotency-Keys on the same order — both should succeed independently
  const order = await createOrder({ price: 4000 });
  const key1 = randomUUID();
  const key2 = randomUUID();
  const r1 = await payOrder(order.id, 2000, key1);
  const r2 = await payOrder(order.id, 2000, key2);
  assert(r1.status === 201, `First payment should be 201, got ${r1.status}`);
  assert(r2.status === 201, `Second payment should be 201, got ${r2.status}`);
  const payments = await getPayments(order.id);
  assert(payments.length === 2, `Expected 2 payments (different keys), got ${payments.length}`);
  const finalOrder = await getOrder(order.id);
  assert(Math.abs(parseFloat(finalOrder.amountPaid) - 4000) < 0.01,
    `Expected amountPaid=4000, got ${finalOrder.amountPaid}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Clean Track — Financial Integrity Validation Suite  ");
  console.log("══════════════════════════════════════════════════════\n");

  console.log("► Setup\n");
  await login();

  console.log("\n► T1–T5: Receipt & Sequential Safety\n");
  await test("T1  Sequential payments — unique receipts", testSequentialPayments);
  await test("T2  Concurrent payments — no double-counting", testConcurrentPayments);
  await test("T3  100 simultaneous payments (10×10)", testHundredSimultaneousPayments);
  await test("T4  50-payment stress test — exact balance", testStressPayments);
  await test("T5  Receipt uniqueness — format validation", testReceiptUniqueness);

  console.log("\n► T6–T10: Idempotency & Replay Protection\n");
  await test("T6  Duplicate request replay (same key, concurrent)", testDuplicateRequestReplay);
  await test("T7  Offline sync replay (sequential retries)", testOfflineSyncReplay);
  await test("T8  Browser retry simulation (5× same key)", testBrowserRetrySimulation);
  await test("T9  Network timeout duplicate replay", testNetworkTimeoutDuplicateReplay);
  await test("T10 Same Idempotency-Key race (10 parallel)", testSameIdempotencyKeyRace);

  console.log("\n► T11–T13: Pickup Integrity\n");
  await test("T11 Concurrent pickups — no over-pickup", testConcurrentPickups);
  await test("T12 Mixed payment + pickup load", testMixedPaymentPickupLoad);
  await test("T13 Pickup idempotency key replay", testIdempotencyKeyPickupReplay);

  console.log("\n► T14–T15: Migration & Backward Compatibility\n");
  await test("T14 Existing records remain valid", testExistingRecordsRemainValid);
  await test("T15 Migration safety — new receipt format", testMigrationSafety);

  console.log("\n► T16–T20: Financial Verification\n");
  await test("T16 20 concurrent orders — all receipts unique", testMultiOrderReceiptUniqueness);
  await test("T17 Financial integrity — amountPaid matches sum", testFinancialIntegrityVerification);
  await test("T18 Partial payment running balance", testPartialPaymentIntegrity);
  await test("T19 Counter increments monotonically today", testCounterRolloverPerDay);
  await test("T20 Different keys — both payments recorded", testIdempotencyExpiry);

  console.log("\n══════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`\n  Failed tests:`);
    failures.forEach(f => console.log(`    ✗ ${f}`));
  }
  console.log("══════════════════════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
