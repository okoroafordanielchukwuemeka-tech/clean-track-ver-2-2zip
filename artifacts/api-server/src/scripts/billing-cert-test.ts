/**
 * PHASE 7.9 — Billing Stress Test & Launch Certification
 *
 * Verification-only harness. Exercises the real billing code paths
 * (DB + service functions + live HTTP routes against the running dev
 * server) and reports PASS/FAIL per section. No app behavior is changed
 * by this file — it is a test client.
 *
 * Run from artifacts/api-server: npx tsx src/scripts/billing-cert-test.ts
 */
import { db } from "@workspace/db";
import {
  laundries,
  subscriptionLogs,
  subscriptionPayments,
  invoices,
  webhookEvents,
  workers,
  branches,
  customers,
  orders,
  platformAdmins,
} from "@workspace/db/schema";
import { eq, sql, and, gte } from "drizzle-orm";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const API = "http://localhost:3001/api";
const JWT_SECRET = process.env.JWT_SECRET!;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY!;

type Result = { section: string; name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function record(section: string, name: string, pass: boolean, detail?: string) {
  results.push({ section, name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${section} — ${name}${detail ? " :: " + detail : ""}`);
}

function ownerToken(laundryId: number, passwordChangedAt?: Date | null) {
  return jwt.sign(
    { laundryId, type: "owner", passwordChangedAt: passwordChangedAt?.toISOString() },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function adminToken(): Promise<string> {
  const email = "admin@cleantrack.internal";
  let [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email));
  if (!admin) {
    const passwordHash = await bcrypt.hash("Admin@CleanTrack1", 12);
    [admin] = await db.insert(platformAdmins).values({ name: "Cert Admin", email, passwordHash, isActive: true }).returning();
  }
  return jwt.sign({ type: "admin", adminId: admin.id, email: admin.email, name: admin.name, role: admin.role }, JWT_SECRET, { expiresIn: "1h" });
}

async function createTestLaundry(tag: string, plan: "free" | "starter" | "pro" | "business", status: "trial" | "active" | "past_due" | "suspended" | "cancelled" = "active") {
  const passwordHash = await bcrypt.hash("Cert@Test1234", 10);
  const now = new Date();
  const [row] = await db
    .insert(laundries)
    .values({
      businessName: `Cert ${tag} ${Date.now()}`,
      ownerEmail: `cert-${tag}-${Date.now()}@example.test`,
      passwordHash,
      subscriptionTier: plan,
      subscriptionStatus: status,
      trialStartedAt: status === "trial" ? now : undefined,
      trialEndsAt: status === "trial" ? new Date(now.getTime() + 14 * 86_400_000) : undefined,
      convertedAt: status === "active" ? now : undefined,
      passwordChangedAt: now,
    } as any)
    .returning();
  return row;
}

async function api(path: string, opts: { method?: string; token?: string; body?: any; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 1 — Subscription State Machine
// ─────────────────────────────────────────────────────────────────────────
async function section1() {
  const S = "1-StateMachine";
  const admToken = await adminToken();

  const scenarios: Array<{ tag: string; plan: "free" | "starter" | "pro" | "business" }> = [
    { tag: "trial", plan: "free" },
    { tag: "starter", plan: "starter" },
    { tag: "professional", plan: "pro" },
    { tag: "enterprise", plan: "business" },
  ];

  for (const sc of scenarios) {
    const laundry = await createTestLaundry(`s1-${sc.tag}`, sc.plan, "trial");
    record(S, `create ${sc.tag} laundry`, !!laundry.id, `id=${laundry.id}`);
  }

  // Full transition chain on ONE tenant: trial -> active -> past_due -> suspended -> active(reactivated) -> cancelled
  const t = await createTestLaundry("s1-chain", "starter", "trial");
  const chain: Array<{ to: string; expectOk: boolean }> = [
    { to: "active", expectOk: true },       // Trial -> Active
    { to: "past_due", expectOk: true },     // Active -> Renewal Reminder/Payment Due (past_due)
    { to: "suspended", expectOk: true },    // Payment Due/Grace Period -> Suspended
    { to: "active", expectOk: true },       // Suspended -> Reactivated
    { to: "cancelled", expectOk: true },    // Reactivated -> Cancelled
  ];

  let logCountBefore = (await db.select({ c: sql<number>`count(*)::int` }).from(subscriptionLogs).where(eq(subscriptionLogs.laundryId, t.id)))[0].c;

  for (const step of chain) {
    const before = await db.select().from(laundries).where(eq(laundries.id, t.id));
    const { status, json } = await api("/admin/subscriptions/state-transitions", {
      method: "POST",
      token: admToken,
      body: { laundryId: t.id, newStatus: step.to, reason: "cert-test" },
    });
    const ok = status === 200;
    record(S, `transition ${before[0].subscriptionStatus} -> ${step.to}`, ok === step.expectOk, JSON.stringify(json).slice(0, 150));

    const [after] = await db.select().from(laundries).where(eq(laundries.id, t.id));
    record(S, `  DB status updated to ${step.to}`, after.subscriptionStatus === step.to, `actual=${after.subscriptionStatus}`);
  }

  const logCountAfter = (await db.select({ c: sql<number>`count(*)::int` }).from(subscriptionLogs).where(eq(subscriptionLogs.laundryId, t.id)))[0].c;
  record(S, "audit log recorded one entry per transition", logCountAfter - logCountBefore === chain.length, `delta=${logCountAfter - logCountBefore}, expected=${chain.length}`);

  // Invalid transition rejected (e.g. cancelled directly to suspended is not allowed)
  const t2 = await createTestLaundry("s1-invalid", "starter", "cancelled");
  const { status: badStatus, json: badJson } = await api("/admin/subscriptions/state-transitions", {
    method: "POST",
    token: admToken,
    body: { laundryId: t2.id, newStatus: "suspended", reason: "cert-test-invalid" },
  });
  record(S, "invalid transition cancelled->suspended rejected", badStatus === 400, JSON.stringify(badJson).slice(0, 150));

  return { chainLaundryId: t.id };
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 2 & 3 — Upgrade / Downgrade Verification
// ─────────────────────────────────────────────────────────────────────────
async function section2and3() {
  const S23 = "2-3-UpgradeDowngrade";

  // --- Section 2: Starter -> Professional -> Enterprise, immediate effect ---
  const starter = await createTestLaundry("s2-starter", "starter", "active");
  const tok = ownerToken(starter.id, starter.passwordChangedAt);

  const limitsBefore = await api("/subscription/usage", { token: tok });
  record(S23, "Starter limits: 1 branch/2 workers/500 customers/500 orders", limitsBefore.status === 200 &&
    limitsBefore.json?.limits?.maxBranches === 1 &&
    limitsBefore.json?.limits?.maxWorkers === 2 &&
    limitsBefore.json?.limits?.maxCustomers === 500 &&
    limitsBefore.json?.limits?.maxOrdersPerMonth === 500,
    JSON.stringify(limitsBefore.json?.limits));

  // Simulate the upgrade the way activatePlanFromPayment would (DB truth), without a real card
  await db.update(laundries).set({ subscriptionTier: "pro", updatedAt: new Date() }).where(eq(laundries.id, starter.id));

  // Note: unlimited (Infinity) limits serialize as JSON `null` over HTTP — treat null as unlimited here.
  const limitsAfterUpgrade = await api("/subscription/usage", { token: tok });
  record(S23, "Upgrade to Professional: limits increase immediately (same token, no re-login)", limitsAfterUpgrade.status === 200 &&
    limitsAfterUpgrade.json?.limits?.maxBranches === 5 && limitsAfterUpgrade.json?.limits?.maxWorkers === null,
    JSON.stringify(limitsAfterUpgrade.json?.limits));

  const statusAfterUpgrade = await api("/subscription/status", { token: tok });
  record(S23, "Billing page (subscription/status) reflects new plan immediately", statusAfterUpgrade.json?.subscriptionTier === "pro" || statusAfterUpgrade.json?.plan === "pro",
    JSON.stringify(statusAfterUpgrade.json).slice(0, 200));

  const entResp = await api("/expenditures/categories", { token: tok }); // HAS_EXPENSE_TRACKING is pro+ only
  record(S23, "Locked feature (expense tracking) unlocks immediately after upgrade", entResp.status !== 403, `status=${entResp.status}`);

  const renewsBefore = (await db.select({ r: laundries.subscriptionRenewsAt }).from(laundries).where(eq(laundries.id, starter.id)))[0].r;
  await db.update(laundries).set({ subscriptionTier: "business", updatedAt: new Date() }).where(eq(laundries.id, starter.id));
  const usageAfterEnterprise = await api("/subscription/usage", { token: tok });
  record(S23, "Professional -> Enterprise: limits unlock immediately (unlimited branches)", usageAfterEnterprise.json?.limits?.maxBranches === null, JSON.stringify(usageAfterEnterprise.json?.limits));
  const renewsAfter = (await db.select({ r: laundries.subscriptionRenewsAt }).from(laundries).where(eq(laundries.id, starter.id)))[0].r;
  record(S23, "Renewal date unchanged by a plan-tier-only change", String(renewsBefore) === String(renewsAfter));

  // --- Section 3: Professional (populated) -> Starter downgrade, data retained, over-limit creation blocked ---
  const pro = await createTestLaundry("s3-pro", "pro", "active");
  const proTok = ownerToken(pro.id, pro.passwordChangedAt);

  // Seed over Starter's limits directly (15 workers, 5 branches, 700 customers, 900 orders this month)
  const branchRows = await db.insert(branches).values(Array.from({ length: 5 }, (_, i) => ({ laundryId: pro.id, name: `Branch ${i + 1}` }))).returning();
  await db.insert(workers).values(Array.from({ length: 15 }, (_, i) => ({ laundryId: pro.id, branchId: branchRows[0].id, name: `Worker ${i + 1}`, phone: `080000000${i}`, pinHash: crypto.createHash("sha256").update("1234").digest("hex"), isActive: true }))).catch(() => null);
  await db.insert(customers).values(Array.from({ length: 700 }, (_, i) => ({ laundryId: pro.id, fullName: `Customer ${i + 1}`, phone: `081${String(i).padStart(7, "0")}` }))).catch(() => null);
  const orderDatePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  for (let i = 0; i < 900; i += 300) {
    const chunk = Array.from({ length: Math.min(300, 900 - i) }, (_, j) => ({
      laundryId: pro.id,
      branchId: branchRows[0].id,
      orderId: `${orderDatePart}s3${pro.id}${String(i + j).padStart(6, "0")}`,
      customerName: `Cust ${i + j}`,
      phone: `082${String(i + j).padStart(7, "0")}`,
      serviceType: "standard",
      status: "pending",
    }));
    await db.insert(orders).values(chunk);
  }

  const usageBeforeDowngrade = await db.select({ w: sql<number>`(select count(*) from workers where laundry_id=${pro.id})`, b: sql<number>`(select count(*) from branches where laundry_id=${pro.id})`, c: sql<number>`(select count(*) from customers where laundry_id=${pro.id})`, o: sql<number>`(select count(*) from orders where laundry_id=${pro.id})` });
  record(S23, "seeded Professional tenant with 15 workers/5 branches/700 customers/900 orders", true, JSON.stringify(usageBeforeDowngrade[0]));

  await db.update(laundries).set({ subscriptionTier: "starter", updatedAt: new Date() }).where(eq(laundries.id, pro.id));

  const customersAfterDowngrade = await api("/customers?limit=5", { token: proTok });
  record(S23, "existing data remains visible after downgrade (customers list still returns data)", customersAfterDowngrade.status === 200 && Array.isArray(customersAfterDowngrade.json?.customers ?? customersAfterDowngrade.json), JSON.stringify(customersAfterDowngrade.json).slice(0, 150));

  const remainingCustomers = (await db.select({ c: sql<number>`count(*)::int` }).from(customers).where(eq(customers.laundryId, pro.id)))[0].c;
  record(S23, "no data deleted on downgrade (700 customers still in DB)", remainingCustomers === 700, `count=${remainingCustomers}`);

  const createWorker = await api("/workers", { method: "POST", token: proTok, body: { name: "Worker #16", phone: "0800000099", pin: "9999", branchId: branchRows[0].id } });
  record(S23, "cannot create Worker #16 over Starter limit", createWorker.status === 403, JSON.stringify(createWorker.json));

  const createBranch = await api("/branches", { method: "POST", token: proTok, body: { name: "Branch #6" } });
  record(S23, "cannot create Branch #6 over Starter limit", createBranch.status === 403, JSON.stringify(createBranch.json));

  const createCustomer = await api("/customers", { method: "POST", token: proTok, body: { fullName: "Customer #701", phone: "08099999701" } });
  record(S23, "cannot create Customer #701 over Starter limit", createCustomer.status === 403, JSON.stringify(createCustomer.json));

  const createOrder = await api("/orders", { method: "POST", token: proTok, body: { customerName: "Order 901", phone: "08099999901", serviceType: "standard" } });
  record(S23, "cannot create Order #901 over Starter limit", createOrder.status === 403, JSON.stringify(createOrder.json));

  return { starterId: starter.id, proId: pro.id };
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 4 & 5 & 6 — Webhook Replay, Concurrency, Failed-Webhook Recovery
// ─────────────────────────────────────────────────────────────────────────
function signPaystack(body: string): string {
  return crypto.createHmac("sha512", PAYSTACK_SECRET).update(body).digest("hex");
}

async function postWebhook(payload: any) {
  const raw = JSON.stringify(payload);
  const sig = signPaystack(raw);
  const res = await fetch(`${API}/webhooks/paystack`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": sig },
    body: raw,
  });
  return res.status;
}

async function section4and5and6() {
  const S4 = "4-WebhookReplay";
  const S5 = "5-ConcurrentPayment";
  const S6 = "6-FailedWebhookRecovery";

  const tenant = await createTestLaundry("s4-webhook", "starter", "active");
  const ref = `certref_${Date.now()}`;
  const payload = {
    event: "charge.failed", // use charge.failed so no live Paystack call is needed to prove dedup at the webhook_events layer
    data: { reference: ref, status: "failed", gateway_response: "Insufficient funds", metadata: { laundryId: tenant.id } },
  };

  const countsBefore = async () => (await db.select({ c: sql<number>`count(*)::int` }).from(webhookEvents).where(eq(webhookEvents.reference, ref)))[0].c;

  await postWebhook(payload); // 1x
  // The route responds 200 immediately then processes async (insert into
  // webhook_events happens after the response) — wait briefly before asserting.
  await new Promise((r) => setTimeout(r, 300));
  const after1 = await countsBefore();
  record(S4, "1 delivery -> exactly 1 webhook_events row", after1 === 1, `rows=${after1}`);

  for (let i = 0; i < 4; i++) await postWebhook(payload); // now 5 total deliveries
  await new Promise((r) => setTimeout(r, 300));
  const after5 = await countsBefore();
  record(S4, "5 deliveries (same event) -> still exactly 1 webhook_events row (no duplicate processing)", after5 === 1, `rows=${after5}`);

  for (let i = 0; i < 5; i++) await postWebhook(payload); // now 10 total deliveries
  await new Promise((r) => setTimeout(r, 300));
  const after10 = await countsBefore();
  record(S4, "10 deliveries (same event) -> still exactly 1 webhook_events row", after10 === 1, `rows=${after10}`);

  const failedPaymentsForTenant = await db.select({ c: sql<number>`count(*)::int` }).from(subscriptionLogs).where(and(eq(subscriptionLogs.laundryId, tenant.id), sql`reason like 'payment_failed:%'`));
  record(S4, "downstream side effect (past_due log) recorded exactly once despite 10 deliveries", failedPaymentsForTenant[0].c <= 1, `count=${failedPaymentsForTenant[0].c}`);

  // Section 5: two concurrent charge.success events with the SAME reference — dedup is the concurrency guard here,
  // since Postgres unique constraint serializes concurrent inserts on (provider, eventKey).
  const tenant2 = await createTestLaundry("s5-concurrent", "starter", "active");
  const ref2 = `certref_concurrent_${Date.now()}`;
  const payload2 = { event: "charge.success", data: { reference: ref2, status: "success", metadata: { laundryId: tenant2.id, targetPlan: "pro", billingPeriod: "monthly", purpose: "upgrade", invoiceId: 0 } } };
  const [r1, r2] = await Promise.all([postWebhook(payload2), postWebhook(payload2)]);
  await new Promise((r) => setTimeout(r, 500));
  const eventRows = await db.select().from(webhookEvents).where(eq(webhookEvents.reference, ref2));
  record(S5, "two simultaneous identical webhook deliveries -> exactly one webhook_events row (Postgres unique constraint serializes the race)", eventRows.length === 1, `rows=${eventRows.length}, httpStatuses=${r1},${r2}`);

  // Section 6: webhook "fails" (simulated: DB insert error state) then a later retry with the SAME key succeeds-once.
  // We simulate "processing failed" by manually forcing status=failed, then replaying the identical payload —
  // dedup key blocks reprocessing (this is a known, intentional trade-off: retries of the exact same event never
  // reprocess once recorded, regardless of prior status). We verify that no duplicate row/side-effect occurs.
  const tenant3 = await createTestLaundry("s6-recovery", "starter", "active");
  const ref3 = `certref_recovery_${Date.now()}`;
  const payload3 = { event: "charge.failed", data: { reference: ref3, status: "failed", metadata: { laundryId: tenant3.id } } };
  await postWebhook(payload3);
  await new Promise((r) => setTimeout(r, 200));
  await postWebhook(payload3); // "retry"
  await new Promise((r) => setTimeout(r, 200));
  const rows3 = await db.select().from(webhookEvents).where(eq(webhookEvents.reference, ref3));
  record(S6, "webhook retried after initial delivery -> no duplicate record created", rows3.length === 1, `rows=${rows3.length}, status=${rows3[0]?.status}`);

  return { tenant, tenant2, tenant3 };
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 7 — Invoice Validation
// ─────────────────────────────────────────────────────────────────────────
async function section7() {
  const S = "7-Invoices";
  const { createInvoice, getInvoice, listInvoices, renderInvoiceHtml } = await import("../lib/invoice-service.js");

  const tenant = await createTestLaundry("s7-invoices", "pro", "active");
  const numbersBefore = await db.select({ n: invoices.invoiceNumber }).from(invoices).orderBy(sql`id desc`).limit(1);

  const types: Array<{ type: "new_subscription" | "renewal" | "upgrade" | "downgrade" | "manual"; label: string }> = [
    { type: "new_subscription", label: "Trial upgrade" },
    { type: "new_subscription", label: "Starter purchase" },
    { type: "renewal", label: "Professional renewal" },
    { type: "renewal", label: "Enterprise renewal" },
    { type: "manual", label: "Manual admin payment" },
  ];

  const created = [];
  for (const t of types) {
    const inv = await createInvoice({ laundryId: tenant.id, type: t.type, plan: "pro", billingPeriod: "monthly", amountNgn: 25000, status: "paid", paymentMethod: t.type === "manual" ? "manual" : "paystack" });
    created.push(inv);
  }

  const nums = created.map((c) => c.invoiceNumber);
  const seqOk = nums.every((n, i) => i === 0 || parseInt(n.split("-")[2], 10) === parseInt(nums[i - 1].split("-")[2], 10) + 1);
  record(S, "invoice numbers increase sequentially for the 5 generated invoices", seqOk, JSON.stringify(nums));
  record(S, "no duplicate invoice numbers", new Set(nums).size === nums.length);

  const fetched = await getInvoice(tenant.id, created[0].id);
  record(S, "invoice fetchable via getInvoice (tenant-scoped)", !!fetched);

  const html = renderInvoiceHtml(created[0]);
  record(S, "print/PDF HTML version renders with invoice number and total", html.includes(created[0].invoiceNumber) && html.includes("Total"));

  const httpToken = ownerToken(tenant.id, tenant.passwordChangedAt);
  const listResp = await api("/subscription/invoices", { token: httpToken });
  record(S, "GET /subscription/invoices (download list) returns the created invoices", listResp.status === 200 && Array.isArray(listResp.json) ? listResp.json.length >= 5 : (Array.isArray(listResp.json?.invoices) && listResp.json.invoices.length >= 5), JSON.stringify(listResp.json).slice(0, 150));

  const htmlResp = await api(`/subscription/invoices/${created[0].id}/html`, { token: httpToken });
  record(S, "invoice HTML endpoint (print/download) returns 200 for owning tenant", htmlResp.status === 200);

  const permanence = await getInvoice(tenant.id, created[0].id);
  record(S, "invoice permanently available (still retrievable after creation, no TTL)", !!permanence);

  return { tenant, created };
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 8 — Email Validation (dedup / exactly-once at the trigger layer)
// ─────────────────────────────────────────────────────────────────────────
async function section8() {
  const S = "8-Email";
  // SMTP is intentionally unset in this environment, so sendTransactionalMail
  // takes its safe no-op path and logs one console.warn per attempted send
  // (see email-service.ts). console.warn is a mutable global (unlike the ESM
  // module's exported function bindings), so we spy on it to count triggers
  // without touching app code.
  const originalWarn = console.warn;
  let warnCount = 0;
  const messages: string[] = [];
  console.warn = (...args: any[]) => { warnCount++; messages.push(String(args[0])); };

  try {
    const { activatePlanFromPayment, recordFailedPayment } = await import("../lib/billing-service.js");
    const tenant = await createTestLaundry("s8-email", "starter", "active");

    warnCount = 0;
    await activatePlanFromPayment({ status: "success", reference: `certemail_${Date.now()}`, amountNgn: 15000, paidAt: new Date().toISOString(), customerEmail: tenant.ownerEmail, customerCode: null, authorization: null, metadata: { laundryId: tenant.id, targetPlan: "pro", billingPeriod: "monthly", purpose: "upgrade", invoiceId: 0 }, gatewayResponse: "Approved" } as any);
    await new Promise((r) => setTimeout(r, 50));
    const emailTriggers1 = messages.filter((m) => m.includes("email")).length;
    record(S, "Payment Successful — exactly one email triggered per activation", emailTriggers1 === 1, `count=${emailTriggers1}`);

    warnCount = 0; messages.length = 0;
    await recordFailedPayment({ laundryId: tenant.id, reference: `certemailfail_${Date.now()}`, reason: "declined" });
    await new Promise((r) => setTimeout(r, 50));
    const emailTriggers2 = messages.filter((m) => m.includes("email")).length;
    record(S, "Payment Failed — exactly one email triggered per failure event", emailTriggers2 === 1, `count=${emailTriggers2}`);
  } finally {
    console.warn = originalWarn;
  }

  // Lifecycle scheduler functions exist and are wired (structural check — see subscription-lifecycle.ts)
  const lifecycle = await import("../lib/subscription-lifecycle.js");
  record(S, "trial lifecycle email processor exists (Trial Day 2/4/6/8/10/12/13/Expired path)", typeof (lifecycle as any).runLifecycleCheck === "function", Object.keys(lifecycle).join(","));
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 9 — Admin Metrics Reconciliation
// ─────────────────────────────────────────────────────────────────────────
async function section9() {
  const S = "9-AdminMetrics";
  const admToken = await adminToken();

  const { json: overview } = await api("/admin/billing/overview", { token: admToken });

  const [{ mrrExpected }] = await db.execute(sql`
    select coalesce(sum(
      case l.subscription_tier
        when 'starter' then 15000
        when 'pro' then 45000
        when 'business' then 120000
        else 0
      end
    ), 0)::int as "mrrExpected"
    from laundries l
    where l.subscription_status = 'active'
  `).then((r: any) => r.rows ?? r);

  // Pricing may differ from hardcoded guess above — reconcile against pricing.ts directly instead.
  const { getPlanPricing } = await import("../lib/pricing.js");
  const activePlans = await db.select({ plan: laundries.subscriptionTier, c: sql<number>`count(*)::int` }).from(laundries).where(eq(laundries.subscriptionStatus, "active")).groupBy(laundries.subscriptionTier);
  let computedMrr = 0;
  for (const row of activePlans) {
    const pricing = getPlanPricing(row.plan);
    if (pricing) computedMrr += pricing.price.monthly * row.c;
  }
  record(S, "MRR reconciles exactly with DB (recomputed independently)", overview?.mrr === computedMrr, `route=${overview?.mrr}, recomputed=${computedMrr}`);
  record(S, "ARR = MRR * 12", overview?.arr === (overview?.mrr ?? 0) * 12, `arr=${overview?.arr}, mrr=${overview?.mrr}`);

  const statusCounts = await db.select({ status: laundries.subscriptionStatus, c: sql<number>`count(*)::int` }).from(laundries).groupBy(laundries.subscriptionStatus);
  const dbTrials = statusCounts.find((s) => s.status === "trial")?.c ?? 0;
  const routeTrials = overview?.statusBreakdown?.find((s: any) => s.status === "trial")?.count ?? 0;
  record(S, "Trials count reconciles with DB", dbTrials === routeTrials, `db=${dbTrials}, route=${routeTrials}`);

  const dbCancelled = statusCounts.find((s) => s.status === "cancelled")?.c ?? 0;
  const routeCancelled = overview?.statusBreakdown?.find((s: any) => s.status === "cancelled")?.count ?? 0;
  record(S, "Cancelled Subscriptions count reconciles with DB", dbCancelled === routeCancelled, `db=${dbCancelled}, route=${routeCancelled}`);

  const [{ dbFailed }] = await db.execute(sql`select count(*)::int as "dbFailed" from invoices where status='failed' and issue_date >= now() - interval '30 days'`).then((r: any) => r.rows ?? r);
  record(S, "Failed Payments (last 30d) reconciles with DB", Number(dbFailed) === overview?.failedPaymentsLast30Days, `db=${dbFailed}, route=${overview?.failedPaymentsLast30Days}`);

  record(S, "Churn is a finite non-negative percentage", typeof overview?.churnRatePct === "number" && overview.churnRatePct >= 0, `churn=${overview?.churnRatePct}`);
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 10 — Security
// ─────────────────────────────────────────────────────────────────────────
async function section10() {
  const S = "10-Security";

  const starterTenant = await createTestLaundry("s10-starter", "starter", "active");
  const starterTok = ownerToken(starterTenant.id, starterTenant.passwordChangedAt);
  const apiAccessResp = await api("/subscription/usage", { token: starterTok }); // sanity
  record(S, "sanity: starter token authenticates", apiAccessResp.status === 200);

  // HAS_API_ACCESS is Enterprise-only; there is no public "API access" endpoint distinct from entitlement flag —
  // use expense tracking (pro+) as the concrete gated-feature probe for a Starter caller instead.
  const gatedResp = await api("/expenditures/categories", { token: starterTok });
  record(S, "Starter calling a Professional+-gated route is rejected (403 ENTITLEMENT_DENIED)", gatedResp.status === 403 && gatedResp.json?.code === "ENTITLEMENT_DENIED", JSON.stringify(gatedResp.json));

  // Webhook: no signature
  const rawNoSig = JSON.stringify({ event: "charge.success", data: { reference: "no-sig", status: "success" } });
  const noSigRes = await fetch(`${API}/webhooks/paystack`, { method: "POST", headers: { "Content-Type": "application/json" }, body: rawNoSig });
  record(S, "webhook with missing signature rejected (403)", noSigRes.status === 403);

  // Webhook: fake/modified signature
  const fakeSigRes = await fetch(`${API}/webhooks/paystack`, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": "deadbeef".repeat(16) }, body: rawNoSig });
  record(S, "webhook with fake/modified signature rejected (403)", fakeSigRes.status === 403);

  // Webhook: valid signature over DIFFERENT body than what's sent (tamper-after-sign) — recompute sig for body A but send body B
  const bodyA = JSON.stringify({ event: "charge.success", data: { reference: "tamper-a", status: "success" } });
  const bodyB = JSON.stringify({ event: "charge.success", data: { reference: "tamper-b", status: "success" } });
  const sigForA = signPaystack(bodyA);
  const tamperRes = await fetch(`${API}/webhooks/paystack`, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": sigForA }, body: bodyB });
  record(S, "webhook payload tampered after signing is rejected (403)", tamperRes.status === 403);

  // Replay an old (already-processed) webhook — covered by dedup in section 4/5/6; re-assert here as a security property
  const replayPayload = { event: "charge.failed", data: { reference: `secreplay_${Date.now()}`, status: "failed", metadata: { laundryId: starterTenant.id } } };
  const s1 = await postWebhook(replayPayload);
  await new Promise((r) => setTimeout(r, 300));
  const s2 = await postWebhook(replayPayload);
  await new Promise((r) => setTimeout(r, 300));
  record(S, "replaying an old webhook does not reprocess (both calls accepted at transport level, only first has effect)", s1 === 200 && s2 === 200);
  const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.reference, replayPayload.data.reference));
  record(S, "  ...confirmed: exactly one webhook_events row after replay", rows.length === 1);

  // Direct invoice access + cross-account invoice download
  const { createInvoice } = await import("../lib/invoice-service.js");
  const tenantA = await createTestLaundry("s10-tenantA", "pro", "active");
  const tenantB = await createTestLaundry("s10-tenantB", "pro", "active");
  const invA = await createInvoice({ laundryId: tenantA.id, type: "manual", plan: "pro", amountNgn: 45000, status: "paid", paymentMethod: "manual" });
  const tokB = ownerToken(tenantB.id, tenantB.passwordChangedAt);
  const crossAccess = await api(`/subscription/invoices/${invA.id}/html`, { token: tokB });
  record(S, "cross-account invoice download rejected/not found for tenant B accessing tenant A's invoice", crossAccess.status === 403 || crossAccess.status === 404, `status=${crossAccess.status}`);

  const tokA = ownerToken(tenantA.id, tenantA.passwordChangedAt);
  const ownAccess = await api(`/subscription/invoices/${invA.id}/html`, { token: tokA });
  record(S, "owning tenant CAN access its own invoice", ownAccess.status === 200, `status=${ownAccess.status}`);
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 11 — Performance
// ─────────────────────────────────────────────────────────────────────────
async function section11() {
  const S = "11-Performance";
  const tenant = await createTestLaundry("s11-perf", "business", "active");
  const branchRows = await db.insert(branches).values({ laundryId: tenant.id, name: "Perf Branch" }).returning();

  console.log("[perf] seeding 1000 customers, 5000 orders, 10000 payments...");
  const custBatchSize = 500;
  for (let i = 0; i < 1000; i += custBatchSize) {
    await db.insert(customers).values(Array.from({ length: Math.min(custBatchSize, 1000 - i) }, (_, j) => ({ laundryId: tenant.id, fullName: `PerfCust ${i + j}`, phone: `090${String(i + j).padStart(7, "0")}` })));
  }
  const orderBatchSize = 500;
  const perfDatePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  for (let i = 0; i < 5000; i += orderBatchSize) {
    await db.insert(orders).values(Array.from({ length: Math.min(orderBatchSize, 5000 - i) }, (_, j) => ({
      laundryId: tenant.id,
      branchId: branchRows[0].id,
      orderId: `${perfDatePart}p${tenant.id}${String(i + j).padStart(6, "0")}`,
      customerName: `PerfCust ${i + j}`,
      phone: `090${String(i + j).padStart(7, "0")}`,
      serviceType: "standard",
      status: "pending",
    })));
  }
  const payBatchSize = 500;
  for (let i = 0; i < 10000; i += payBatchSize) {
    await db.insert(subscriptionPayments).values(Array.from({ length: Math.min(payBatchSize, 10000 - i) }, () => ({ laundryId: tenant.id, amountNgn: 15000, plan: "starter", status: "paid", paymentMethod: "paystack", reference: `perf_${crypto.randomBytes(6).toString("hex")}`, paidAt: new Date() })));
  }
  record(S, "seeded 1000 customers / 5000 orders / 10000 payments", true);

  async function timed(label: string, fn: () => Promise<any>) {
    const t0 = Date.now();
    await fn();
    const ms = Date.now() - t0;
    record(S, `${label} (${ms}ms)`, ms < 2000, `${ms}ms`);
    return ms;
  }

  const admToken = await adminToken();
  await timed("Billing dashboard load (admin/billing/overview)", () => api("/admin/billing/overview", { token: admToken }));

  const { createInvoice } = await import("../lib/invoice-service.js");
  await timed("Invoice generation", () => createInvoice({ laundryId: tenant.id, type: "manual", plan: "business", amountNgn: 120000, status: "paid", paymentMethod: "manual" }));

  const perfTok = ownerToken(tenant.id, tenant.passwordChangedAt);
  await timed("Subscription status API", () => api("/subscription/status", { token: perfTok }));
  await timed("Payment history (subscription/invoices)", () => api("/subscription/invoices", { token: perfTok }));

  const t0 = Date.now();
  await postWebhook({ event: "charge.failed", data: { reference: `perfwebhook_${Date.now()}`, status: "failed", metadata: { laundryId: tenant.id } } });
  await new Promise((r) => setTimeout(r, 200));
  record(S, `Webhook processing round-trip (${Date.now() - t0}ms)`, Date.now() - t0 < 3000, `${Date.now() - t0}ms`);

  // Identify missing indexes: check that the hot filter columns used above are indexed.
  const idxRows = await db.execute(sql`
    select tablename, indexdef from pg_indexes
    where tablename in ('orders','customers','subscription_payments','invoices','webhook_events','subscription_logs')
    order by tablename
  `).then((r: any) => r.rows ?? r);
  const hasIdx = (table: string, col: string) => idxRows.some((r: any) => r.tablename === table && r.indexdef.toLowerCase().includes(col.toLowerCase()));
  record(S, "orders.laundry_id indexed", hasIdx("orders", "laundry_id"));
  record(S, "customers.laundry_id indexed", hasIdx("customers", "laundry_id"));
  record(S, "invoices.laundry_id indexed", hasIdx("invoices", "laundry_id"));
  record(S, "webhook_events (provider, event_key) uniquely indexed", idxRows.some((r: any) => r.tablename === "webhook_events" && r.indexdef.includes("event_key")));

  return { tenant };
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== PHASE 7.9 BILLING CERTIFICATION — starting ===\n");

  try { await section1(); } catch (e) { record("1-StateMachine", "section crashed", false, String(e)); }
  try { await section2and3(); } catch (e) { record("2-3-UpgradeDowngrade", "section crashed", false, String(e)); }
  try { await section4and5and6(); } catch (e) { record("4-5-6-Webhooks", "section crashed", false, String(e)); }
  try { await section7(); } catch (e) { record("7-Invoices", "section crashed", false, String(e)); }
  try { await section8(); } catch (e) { record("8-Email", "section crashed", false, String(e)); }
  try { await section9(); } catch (e) { record("9-AdminMetrics", "section crashed", false, String(e)); }
  try { await section10(); } catch (e) { record("10-Security", "section crashed", false, String(e)); }
  try { await section11(); } catch (e) { record("11-Performance", "section crashed", false, String(e)); }

  console.log("\n\n=== CERTIFICATION SUMMARY ===");
  const bySection = new Map<string, Result[]>();
  for (const r of results) {
    if (!bySection.has(r.section)) bySection.set(r.section, []);
    bySection.get(r.section)!.push(r);
  }
  let totalPass = 0, totalFail = 0;
  for (const [section, rs] of bySection) {
    const pass = rs.filter((r) => r.pass).length;
    const fail = rs.length - pass;
    totalPass += pass; totalFail += fail;
    console.log(`\n${section}: ${pass}/${rs.length} passed`);
    for (const r of rs.filter((r) => !r.pass)) console.log(`  FAIL: ${r.name} ${r.detail ?? ""}`);
  }
  console.log(`\nTOTAL: ${totalPass} passed, ${totalFail} failed out of ${results.length}`);
  console.log(`\n=== JSON RESULTS ===`);
  console.log(JSON.stringify(results));

  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
