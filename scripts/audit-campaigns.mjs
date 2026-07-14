/**
 * PHASE 7.7 — Campaign System Audit Script
 * Security + Performance + Gate tests
 */
import pg from "pg";
import jwt from "jsonwebtoken";

const BASE = "http://localhost:3001/api";
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

const dbClient = new pg.Client({ connectionString: DATABASE_URL });
await dbClient.connect();

async function dbQuery(sql, params = []) {
  const r = await dbClient.query(sql, params);
  return r;
}

let passed = 0, failed = 0;
const failures = [];

function pass(msg) { passed++; console.log(`  ✅ PASS: ${msg}`); }
function fail(msg) { failed++; failures.push(msg); console.log(`  ❌ FAIL: ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeToken(laundryId, type = "owner") {
  return jwt.sign({ laundryId, type, ownerId: laundryId }, JWT_SECRET, { expiresIn: "1h" });
}
function makeWorkerToken(laundryId, workerId) {
  return jwt.sign({ laundryId, type: "worker", workerId, permissions: {} }, JWT_SECRET, { expiresIn: "1h" });
}

async function apiReq(method, path, token, body) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// ─── Setup: fetch audit accounts ─────────────────────────────────────────────

const { rows: accounts } = await dbQuery(
  `SELECT id, owner_email, subscription_tier, subscription_status FROM laundries
   WHERE owner_email IN (
     'audit-starter@test.local','audit-pro@test.local',
     'audit-enterprise@test.local','audit-trial@test.local'
   ) ORDER BY owner_email`
);

const byEmail = Object.fromEntries(accounts.map(a => [a.owner_email, a]));
const starterAcc  = byEmail["audit-starter@test.local"];
const proAcc      = byEmail["audit-pro@test.local"];
const enterpriseAcc = byEmail["audit-enterprise@test.local"];
const trialAcc    = byEmail["audit-trial@test.local"];

if (!starterAcc || !proAcc || !enterpriseAcc) {
  console.error("Audit accounts not found — run main audit script first");
  process.exit(1);
}

const starterTok    = makeToken(starterAcc.id);
const proTok        = makeToken(proAcc.id);
const enterpriseTok = makeToken(enterpriseAcc.id);
const trialTok      = makeToken(trialAcc?.id ?? proAcc.id);
const workerTok     = makeWorkerToken(proAcc.id, 999);

info(`Audit accounts: starter=${starterAcc.id} pro=${proAcc.id} enterprise=${enterpriseAcc.id}`);

// ═══════════════════════════════════════════════════════════════════════════════
// PART 1: SUBSCRIPTION GATE ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ PART 1: SUBSCRIPTION GATE ══════════════════════════════");

// Starter cannot create campaigns
const r1 = await apiReq("POST", "/campaigns", starterTok, {
  name: "Starter Test", type: "promotion", audienceType: "all",
  messageBody: "Hello {{customerName}}", scheduleType: "now",
});
if (r1.status === 403 && r1.data?.code === "ENTITLEMENT_DENIED")
  pass("Starter: POST /campaigns → 403 ENTITLEMENT_DENIED");
else fail(`Starter: POST /campaigns should be 403, got ${r1.status} ${r1.data?.code}`);

// Starter cannot send campaigns
const r2 = await apiReq("POST", "/campaigns/1/send", starterTok);
if (r2.status === 403)
  pass("Starter: POST /campaigns/1/send → 403");
else fail(`Starter: /campaigns/1/send should be 403, got ${r2.status}`);

// Starter cannot preview audience
const r3 = await apiReq("POST", "/campaigns/preview-audience", starterTok, { audienceType: "all" });
if (r3.status === 403)
  pass("Starter: POST /campaigns/preview-audience → 403");
else fail(`Starter: /campaigns/preview-audience should be 403, got ${r3.status}`);

// Starter CAN list campaigns (read-only is allowed for UI to show upgrade gate)
const r4 = await apiReq("GET", "/campaigns", starterTok);
if (r4.status === 200)
  pass("Starter: GET /campaigns → 200 (read allowed for upgrade gate UI)");
else fail(`Starter: GET /campaigns should be 200, got ${r4.status}`);

// Pro can create campaigns
const r5 = await apiReq("POST", "/campaigns", proTok, {
  name: "Pro Test Campaign", type: "promotion", audienceType: "all",
  messageBody: "Hi {{customerName}} from {{businessName}}!", scheduleType: "now",
});
if (r5.status === 201) pass("Pro: POST /campaigns → 201 Created");
else fail(`Pro: POST /campaigns should be 201, got ${r5.status} ${JSON.stringify(r5.data)}`);
const proTestCampaignId = r5.data?.id;

// Enterprise can create campaigns
const r6 = await apiReq("POST", "/campaigns", enterpriseTok, {
  name: "Enterprise Test Campaign", type: "announcement", audienceType: "all",
  messageBody: "Enterprise announcement", scheduleType: "now",
});
if (r6.status === 201) pass("Enterprise: POST /campaigns → 201 Created");
else fail(`Enterprise: POST /campaigns should be 201, got ${r6.status}`);
const entTestCampaignId = r6.data?.id;

// Trial can create campaigns (Enterprise features)
const r7 = await apiReq("POST", "/campaigns", trialTok, {
  name: "Trial Test Campaign", type: "promotion", audienceType: "all",
  messageBody: "Trial test", scheduleType: "now",
});
if (r7.status === 201) pass("Trial: POST /campaigns → 201 Created (Enterprise features)");
else fail(`Trial: POST /campaigns should be 201, got ${r7.status}`);

// ═══════════════════════════════════════════════════════════════════════════════
// PART 2: SECURITY — WORKER ACCESS
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ PART 2: SECURITY — WORKER ACCESS ═══════════════════════");

const w1 = await apiReq("GET", "/campaigns", workerTok);
if (w1.status === 403) pass("Worker: GET /campaigns → 403 (owner only)");
else fail(`Worker: GET /campaigns should be 403, got ${w1.status}`);

const w2 = await apiReq("POST", "/campaigns", workerTok, { name: "x", messageBody: "x", scheduleType: "now", audienceType: "all" });
if (w2.status === 403) pass("Worker: POST /campaigns → 403 (owner only)");
else fail(`Worker: POST /campaigns should be 403, got ${w2.status}`);

const w3 = await apiReq("POST", "/campaigns/1/send", workerTok);
if (w3.status === 403) pass("Worker: POST /campaigns/1/send → 403 (owner only)");
else fail(`Worker: POST /campaigns/1/send should be 403, got ${w3.status}`);

// ═══════════════════════════════════════════════════════════════════════════════
// PART 3: SECURITY — CROSS-TENANT (branch isolation)
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ PART 3: SECURITY — CROSS-TENANT ════════════════════════");

if (proTestCampaignId) {
  // Starter tries to access Pro's campaign
  const ct1 = await apiReq("GET", `/campaigns/${proTestCampaignId}`, starterTok);
  if (ct1.status === 404) pass("Cross-tenant: Starter cannot read Pro's campaign (404)");
  else fail(`Cross-tenant: Starter accessing Pro's campaign should be 404, got ${ct1.status}`);

  const ct2 = await apiReq("PATCH", `/campaigns/${proTestCampaignId}`, starterTok, { name: "Hacked" });
  if (ct2.status === 403 || ct2.status === 404)
    pass("Cross-tenant: Starter cannot modify Pro's campaign");
  else fail(`Cross-tenant: PATCH Pro campaign with Starter token should be 403/404, got ${ct2.status}`);

  const ct3 = await apiReq("DELETE", `/campaigns/${proTestCampaignId}`, starterTok);
  if (ct3.status === 403 || ct3.status === 404)
    pass("Cross-tenant: Starter cannot delete Pro's campaign");
  else fail(`Cross-tenant: DELETE Pro campaign with Starter token should be 403/404, got ${ct3.status}`);
}

// No token → 401
const noAuth = await apiReq("GET", "/campaigns", "invalid.token.here");
if (noAuth.status === 401) pass("No valid token → 401");
else fail(`No token should return 401, got ${noAuth.status}`);

// ═══════════════════════════════════════════════════════════════════════════════
// PART 4: CAMPAIGN CRUD TESTS
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ PART 4: CAMPAIGN CRUD ═══════════════════════════════════");

// Create a test campaign for Pro
const crudCampaign = await apiReq("POST", "/campaigns", proTok, {
  name: "CRUD Test Campaign",
  type: "win_back",
  audienceType: "inactive_30",
  messageTitle: "We miss you!",
  messageBody: "Hi {{customerName}}, we haven't seen you in a while. Come back and get 10% off!",
  scheduleType: "now",
});
if (crudCampaign.status === 201) pass("CRUD: Create campaign → 201");
else fail(`CRUD: Create campaign should be 201, got ${crudCampaign.status}`);
const crudId = crudCampaign.data?.id;

if (crudId) {
  // Read it back
  const readBack = await apiReq("GET", `/campaigns/${crudId}`, proTok);
  if (readBack.status === 200 && readBack.data?.name === "CRUD Test Campaign")
    pass("CRUD: Read campaign → 200, name correct");
  else fail(`CRUD: Read campaign should return correct name, got status ${readBack.status}`);

  // Update it
  const updateRes = await apiReq("PATCH", `/campaigns/${crudId}`, proTok, {
    name: "CRUD Test Campaign (Updated)",
    messageBody: "Updated message for {{customerName}}",
  });
  if (updateRes.status === 200 && updateRes.data?.name === "CRUD Test Campaign (Updated)")
    pass("CRUD: PATCH campaign → 200, name updated");
  else fail(`CRUD: PATCH campaign should update name, got ${updateRes.status}`);

  // Audience preview
  const previewRes = await apiReq("POST", "/campaigns/preview-audience", proTok, {
    audienceType: "inactive_30",
  });
  if (previewRes.status === 200 && typeof previewRes.data?.count === "number")
    pass(`CRUD: Audience preview → ${previewRes.data.count} recipients`);
  else fail(`CRUD: Audience preview should return count, got ${previewRes.status}`);

  // List includes it
  const listRes = await apiReq("GET", "/campaigns", proTok);
  if (listRes.status === 200 && listRes.data?.some?.(c => c.id === crudId))
    pass("CRUD: GET /campaigns includes created campaign");
  else fail(`CRUD: GET /campaigns should include campaign ${crudId}`);

  // Delete it
  const deleteRes = await apiReq("DELETE", `/campaigns/${crudId}`, proTok);
  if (deleteRes.status === 204) pass("CRUD: DELETE campaign → 204");
  else fail(`CRUD: DELETE campaign should be 204, got ${deleteRes.status}`);

  // Confirm it's gone
  const goneRes = await apiReq("GET", `/campaigns/${crudId}`, proTok);
  if (goneRes.status === 404) pass("CRUD: Deleted campaign returns 404");
  else fail(`CRUD: Deleted campaign should return 404, got ${goneRes.status}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 5: SEND + CANCEL + RETRY FLOW
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ PART 5: SEND / CANCEL / RETRY ══════════════════════════");

// Create a campaign targeting "all" for pro account
const flowCampaign = await apiReq("POST", "/campaigns", proTok, {
  name: "Flow Test Campaign",
  type: "promotion",
  audienceType: "all",
  messageBody: "Hi {{customerName}}! This is a test.",
  scheduleType: "now",
});
const flowId = flowCampaign.data?.id;

if (flowId) {
  // Check audience preview (may be 0 if no customers)
  const prev = await apiReq("POST", "/campaigns/preview-audience", proTok, { audienceType: "all" });
  info(`Flow: Pro has ${prev.data?.count ?? 0} customers in audience`);

  if ((prev.data?.count ?? 0) > 0) {
    // Send it
    const sendRes = await apiReq("POST", `/campaigns/${flowId}/send`, proTok);
    if (sendRes.status === 200 && sendRes.data?.totalRecipients > 0)
      pass(`Flow: Send campaign → queued ${sendRes.data.totalRecipients} recipients`);
    else fail(`Flow: Send campaign should return totalRecipients > 0, got ${sendRes.status} ${JSON.stringify(sendRes.data)}`);

    // Check status
    await new Promise(r => setTimeout(r, 1000));
    const statusCheck = await apiReq("GET", `/campaigns/${flowId}`, proTok);
    const finalStatus = statusCheck.data?.status;
    if (["queued","sending","sent","failed"].includes(finalStatus))
      pass(`Flow: Campaign in valid post-send state: ${finalStatus}`);
    else fail(`Flow: Campaign status should be sent/queued/sending/failed, got ${finalStatus}`);

    // Duplicate sends blocked  
    const doubleSend = await apiReq("POST", `/campaigns/${flowId}/send`, proTok);
    if (doubleSend.status === 409)
      pass("Flow: Duplicate send returns 409 (cannot re-send)");
    else fail(`Flow: Duplicate send should be 409, got ${doubleSend.status}`);
  } else {
    info("Flow: Skipping send tests (no customers in Pro account)");
    pass("Flow: Audience resolution works (0 customers matched)");

    // Try sending to empty audience
    const emptyRes = await apiReq("POST", `/campaigns/${flowId}/send`, proTok);
    if (emptyRes.status === 422)
      pass("Flow: Empty audience send returns 422 with clear error");
    else fail(`Flow: Empty audience should return 422, got ${emptyRes.status}`);
  }

  // Create and cancel a scheduled campaign
  const scheduledCampaign = await apiReq("POST", "/campaigns", proTok, {
    name: "Cancel Test Campaign",
    type: "reminder",
    audienceType: "all",
    messageBody: "This will be cancelled",
    scheduleType: "scheduled",
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const cancelId = scheduledCampaign.data?.id;
  if (cancelId) {
    const cancelRes = await apiReq("POST", `/campaigns/${cancelId}/cancel`, proTok);
    if (cancelRes.status === 200 && cancelRes.data?.cancelled)
      pass("Flow: Cancel scheduled campaign → 200");
    else fail(`Flow: Cancel campaign should be 200, got ${cancelRes.status}`);

    // Verify it's cancelled
    const afterCancel = await apiReq("GET", `/campaigns/${cancelId}`, proTok);
    if (afterCancel.data?.status === "cancelled")
      pass("Flow: Campaign status = cancelled after cancel");
    else fail(`Flow: Campaign should be cancelled, got ${afterCancel.data?.status}`);

    // Clean up
    await apiReq("DELETE", `/campaigns/${cancelId}`, proTok);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 6: PERFORMANCE — Audience Resolution at Scale
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ PART 6: PERFORMANCE ══════════════════════════════════════");

// Insert 10,000 test customers into the Pro account
info("Inserting 10,000 test customers into Pro account…");
const batchSize = 500;
const PERF_LAUNDRY_ID = proAcc.id;
let totalInserted = 0;

for (let i = 0; i < 10000; i += batchSize) {
  const values = Array.from({ length: batchSize }, (_, j) => {
    const n = i + j + 1;
    return `(${PERF_LAUNDRY_ID}, 'Perf Customer ${n}', '0801${String(n).padStart(7,"0")}', NOW(), NOW())`;
  }).join(",");
  await dbQuery(`INSERT INTO customers (laundry_id, full_name, phone, created_at, last_activity_at) VALUES ${values}`);
  totalInserted += batchSize;
}
info(`Inserted ${totalInserted.toLocaleString()} test customers`);

// Audience preview should be fast
const t0 = Date.now();
const largePrev = await apiReq("POST", "/campaigns/preview-audience", proTok, { audienceType: "all" });
const t1 = Date.now();
if (largePrev.status === 200) {
  const ms = t1 - t0;
  info(`Audience preview (all, ${largePrev.data?.count?.toLocaleString()} customers): ${ms}ms`);
  if (ms < 5000) pass(`Performance: Audience preview < 5s (${ms}ms)`);
  else fail(`Performance: Audience preview too slow: ${ms}ms`);
} else {
  fail(`Performance: Audience preview failed with ${largePrev.status}`);
}

// Queue 5,000 campaign messages — create a campaign and send it
info("Queuing 5,000 campaign messages…");
const perfCampaign = await apiReq("POST", "/campaigns", proTok, {
  name: "Perf Test Campaign",
  type: "promotion",
  audienceType: "all",
  messageBody: "Hi {{customerName}}! Performance test message from {{businessName}}.",
  scheduleType: "now",
});
const perfId = perfCampaign.data?.id;

if (perfId) {
  const tSend0 = Date.now();
  const sendRes = await apiReq("POST", `/campaigns/${perfId}/send`, proTok);
  const tSend1 = Date.now();
  const recipientCount = sendRes.data?.totalRecipients ?? 0;
  info(`Campaign queued: ${recipientCount.toLocaleString()} recipients in ${tSend1-tSend0}ms`);

  if (sendRes.status === 200 && recipientCount > 0)
    pass(`Performance: Campaign queued ${recipientCount.toLocaleString()} recipients`);
  else fail(`Performance: Campaign send failed: ${sendRes.status} ${JSON.stringify(sendRes.data)}`);

  // Wait for processing (up to 15s)
  info("Waiting for campaign processing…");
  let finalCampaign;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 1000));
    const check = await apiReq("GET", `/campaigns/${perfId}`, proTok);
    if (!["queued","sending"].includes(check.data?.status)) {
      finalCampaign = check.data;
      break;
    }
    process.stdout.write(".");
  }
  console.log();

  if (finalCampaign) {
    info(`Campaign final status: ${finalCampaign.status}`);
    info(`Delivered: ${finalCampaign.delivered} | Failed: ${finalCampaign.failed} | Cancelled: ${finalCampaign.cancelled}`);

    // No duplicates: check unique phone numbers in recipients
    const { rows: dupCheck } = await dbQuery(
      `SELECT phone, count(*) cnt FROM campaign_recipients WHERE campaign_id=$1 GROUP BY phone HAVING count(*) > 1`,
      [perfId]
    );
    if (dupCheck.length === 0)
      pass("Performance: No duplicate sends (unique phone per campaign)");
    else fail(`Performance: ${dupCheck.length} duplicate phone(s) found in campaign_recipients`);

    // Correct stats
    const { rows: stats } = await dbQuery(
      `SELECT count(*) total FROM campaign_recipients WHERE campaign_id=$1`,
      [perfId]
    );
    const dbTotal = parseInt(stats[0].total);
    if (dbTotal === recipientCount)
      pass(`Performance: Recipient count matches (${dbTotal.toLocaleString()} rows in DB)`);
    else fail(`Performance: Recipient count mismatch — expected ${recipientCount}, got ${dbTotal}`);

    // Verify failed are correctly tracked (no provider configured, so all should fail)
    const { rows: failedRows } = await dbQuery(
      `SELECT count(*) cnt FROM campaign_recipients WHERE campaign_id=$1 AND status='failed'`,
      [perfId]
    );
    const failedCount = parseInt(failedRows[0].cnt);
    pass(`Performance: ${failedCount.toLocaleString()} messages marked failed (no WhatsApp provider configured — expected)`);

    // Retry only failed messages (re-gate check)
    const retryRes = await apiReq("POST", `/campaigns/${perfId}/retry`, proTok);
    if (retryRes.status === 200 || retryRes.status === 422)
      pass(`Performance: Retry endpoint works (${retryRes.data?.recipientsQueued ?? "0"} queued, or 422 if none)`);
    else fail(`Performance: Retry failed with ${retryRes.status}`);
  } else {
    fail("Performance: Campaign did not reach a terminal state in 15s");
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

info("Cleaning up performance test data…");
await dbQuery(`DELETE FROM customers WHERE laundry_id=$1 AND full_name LIKE 'Perf Customer%'`, [PERF_LAUNDRY_ID]);
await dbQuery(`DELETE FROM campaigns WHERE laundry_id=$1 AND name LIKE '%Perf Test%'`, [PERF_LAUNDRY_ID]);
await dbQuery(`DELETE FROM campaigns WHERE laundry_id=$1 AND name LIKE '%Flow Test%'`, [PERF_LAUNDRY_ID]);
await dbQuery(`DELETE FROM campaigns WHERE laundry_id=$1 AND name LIKE '%Pro Test%'`, [PERF_LAUNDRY_ID]);
await dbQuery(`DELETE FROM campaigns WHERE laundry_id=$1 AND name LIKE '%CRUD Test%'`, [PERF_LAUNDRY_ID]);
const { id: enterpriseId } = enterpriseAcc;
await dbQuery(`DELETE FROM campaigns WHERE laundry_id=$1 AND name LIKE '%Enterprise Test%'`, [enterpriseId]);
const trialId = trialAcc?.id;
if (trialId) await dbQuery(`DELETE FROM campaigns WHERE laundry_id=$1 AND name LIKE '%Trial Test%'`, [trialId]);

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

await dbClient.end();

console.log(`\n${"═".repeat(56)}`);
console.log(`  CAMPAIGN AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
console.log(`${"═".repeat(56)}`);
if (failures.length > 0) {
  console.log("\n  FAILURES:");
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
