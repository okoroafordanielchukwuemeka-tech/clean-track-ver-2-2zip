import { createRequire } from "module";
const require = createRequire(import.meta.url);

const BASE = "http://localhost:3001/api";
let TOKEN = "";
let ORDER_ID = null;
let LAUNDRY_ID = null;

const PASS = "✅";
const FAIL = "❌";
const INFO = "ℹ️ ";

function check(label, condition, detail = "") {
  const icon = condition ? PASS : FAIL;
  console.log(`  ${icon} ${label}${detail ? " — " + detail : ""}`);
  if (!condition) process.exitCode = 1;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function run() {
  console.log("\n══════════════════════════════════════════════");
  console.log("  PARTIAL PICKUP LOGIC — END-TO-END TEST");
  console.log("══════════════════════════════════════════════\n");

  // ─── 1. AUTH ──────────────────────────────────────────
  console.log("▸ Step 1: Authenticate");
  const auth = await api("POST", "/auth/owner-login", {
    email: "demo@cleantrack.ng",
    password: "Demo@1234",
  });
  check("Login status 200", auth.status === 200, `got ${auth.status}`);
  TOKEN = auth.data.token;
  LAUNDRY_ID = auth.data.laundry?.id;
  check("Token received", !!TOKEN);
  check("Laundry ID present", !!LAUNDRY_ID, `laundryId=${LAUNDRY_ID}`);

  // ─── 2. GET BRANCH ────────────────────────────────────
  console.log("\n▸ Step 2: Resolve branch");
  const branches = await api("GET", "/branches");
  const branch = branches.data[0];
  check("Has branches", branches.data.length > 0);
  console.log(`  ${INFO} Using branch: ${branch.name} (id=${branch.id})`);

  // ─── 3. GET SERVICES ──────────────────────────────────
  console.log("\n▸ Step 3: Fetch services");
  const svcs = await api("GET", "/services");
  const shirt = svcs.data.find(s => s.name.includes("Shirt"));
  const trouser = svcs.data.find(s => s.name.includes("Trouser"));
  const bedsheet = svcs.data.find(s => s.name.includes("Bedsheet"));
  check("Shirt service found", !!shirt, shirt?.name);
  check("Trouser service found", !!trouser, trouser?.name);
  check("Bedsheet service found", !!bedsheet, bedsheet?.name);

  // ─── 4. CREATE ORDER ──────────────────────────────────
  console.log("\n▸ Step 4: Create test order (5 Shirts, 3 Trousers, 2 Bedsheets)");
  const orderRes = await api("POST", "/orders", {
    customerName: "Test Pickup Customer",
    phone: "08099999999",
    serviceType: "standard",
    branchId: branch.id,
    items: [
      { serviceId: shirt.id,    quantity: 5 },
      { serviceId: trouser.id,  quantity: 3 },
      { serviceId: bedsheet.id, quantity: 2 },
    ],
  });
  check("Order created (201)", orderRes.status === 201, `got ${orderRes.status}`);
  if (orderRes.status !== 201) {
    console.log("  Create error:", JSON.stringify(orderRes.data));
    process.exit(1);
  }
  ORDER_ID = orderRes.data.id;
  const orderId = orderRes.data.orderId;
  console.log(`  ${INFO} Order ID: ${orderId} (db id=${ORDER_ID})`);
  check("Has items", orderRes.data.items?.length === 3, `${orderRes.data.items?.length} items`);
  check("Shirt qty=5", orderRes.data.items?.find(i => i.name?.includes("Shirt"))?.quantity === 5);
  check("Trouser qty=3", orderRes.data.items?.find(i => i.name?.includes("Trouser"))?.quantity === 3);
  check("Bedsheet qty=2", orderRes.data.items?.find(i => i.name?.includes("Bedsheet"))?.quantity === 2);
  check("Initial status=pending", orderRes.data.status === "pending", `got ${orderRes.data.status}`);
  const totalExpected = (shirt.standardPrice * 5) + (trouser.standardPrice * 3) + (bedsheet.standardPrice * 2);
  console.log(`  ${INFO} Expected total: ₦${totalExpected}`);

  // ─── 5. SET STATUS = READY ────────────────────────────
  console.log("\n▸ Step 5: Mark order as ready");
  const readyRes = await api("PATCH", `/orders/${ORDER_ID}`, { status: "ready" });
  check("Status updated (200)", readyRes.status === 200, `got ${readyRes.status}`);
  check("Status is ready", readyRes.data.status === "ready", `got ${readyRes.data.status}`);

  // ─── 6. PARTIAL PICKUP #1 ─────────────────────────────
  console.log("\n▸ Step 6: Partial Pickup #1 — 2 Shirts, 1 Trouser");
  const order6 = await api("GET", `/orders/${ORDER_ID}`);
  const shirtItemId  = order6.data.items.find(i => i.name?.includes("Shirt"))?.id;
  const trouserItemId = order6.data.items.find(i => i.name?.includes("Trouser"))?.id;
  const bedsheetItemId = order6.data.items.find(i => i.name?.includes("Bedsheet"))?.id;
  check("Item IDs resolved", !!(shirtItemId && trouserItemId && bedsheetItemId));

  const p1Res = await api("POST", `/orders/${ORDER_ID}/pickups`, {
    items: [
      { orderItemId: shirtItemId,   quantity: 2 },
      { orderItemId: trouserItemId, quantity: 1 },
    ],
    notes: "Customer took 2 shirts and 1 trouser",
  });
  check("Pickup recorded (200/201)", [200, 201].includes(p1Res.status), `got ${p1Res.status}`);
  if (![200,201].includes(p1Res.status)) {
    console.log("  Pickup error:", JSON.stringify(p1Res.data));
    process.exit(1);
  }

  // ─── 7. VERIFY AFTER PARTIAL PICKUP ──────────────────
  console.log("\n▸ Step 7: Verify state after Partial Pickup #1");
  const order7 = await api("GET", `/orders/${ORDER_ID}`);
  const o7 = order7.data;
  check("Status=partial_pickup", o7.status === "partial_pickup", `got ${o7.status}`);
  const shirtItem7    = o7.items.find(i => i.name?.includes("Shirt"));
  const trouserItem7  = o7.items.find(i => i.name?.includes("Trouser"));
  const bedsheetItem7 = o7.items.find(i => i.name?.includes("Bedsheet"));
  check("Shirt: 2 picked up", shirtItem7?.quantityPickedUp === 2, `got ${shirtItem7?.quantityPickedUp}`);
  check("Shirt: 3 remaining", (shirtItem7?.quantity - shirtItem7?.quantityPickedUp) === 3,
    `remaining=${shirtItem7?.quantity - shirtItem7?.quantityPickedUp}`);
  check("Trouser: 1 picked up", trouserItem7?.quantityPickedUp === 1, `got ${trouserItem7?.quantityPickedUp}`);
  check("Trouser: 2 remaining", (trouserItem7?.quantity - trouserItem7?.quantityPickedUp) === 2,
    `remaining=${trouserItem7?.quantity - trouserItem7?.quantityPickedUp}`);
  check("Bedsheet: 0 picked up", bedsheetItem7?.quantityPickedUp === 0, `got ${bedsheetItem7?.quantityPickedUp}`);
  check("Bedsheet: 2 remaining", (bedsheetItem7?.quantity - bedsheetItem7?.quantityPickedUp) === 2,
    `remaining=${bedsheetItem7?.quantity - bedsheetItem7?.quantityPickedUp}`);
  check("No quantity is negative", [shirtItem7, trouserItem7, bedsheetItem7].every(
    i => (i?.quantity - i?.quantityPickedUp) >= 0
  ));

  // Pickup history after partial
  const pickups7 = await api("GET", `/orders/${ORDER_ID}/pickups`);
  check("Pickup history has 1 record", pickups7.data?.length === 1, `got ${pickups7.data?.length}`);
  check("Pickup notes recorded", pickups7.data?.[0]?.notes?.includes("2 shirts"), pickups7.data?.[0]?.notes);

  // ─── 8. EDGE CASE: PICKUP > REMAINING ─────────────────
  console.log("\n▸ Step 8: Edge case — Pickup exceeding remaining quantity");
  const edgeOver = await api("POST", `/orders/${ORDER_ID}/pickups`, {
    items: [{ orderItemId: shirtItemId, quantity: 99 }],
  });
  check("Rejected (400/422)", [400, 422].includes(edgeOver.status),
    `got ${edgeOver.status} — ${JSON.stringify(edgeOver.data?.error ?? edgeOver.data).slice(0, 80)}`);
  // Verify state not corrupted
  const orderAfterOver = await api("GET", `/orders/${ORDER_ID}`);
  const shirtAfterOver = orderAfterOver.data.items.find(i => i.name?.includes("Shirt"));
  check("Shirt qty unchanged after rejected pickup",
    shirtAfterOver?.quantityPickedUp === 2, `got ${shirtAfterOver?.quantityPickedUp}`);

  // ─── 9. EDGE CASE: PICKUP = 0 ─────────────────────────
  console.log("\n▸ Step 9: Edge case — Pickup with zero quantity");
  const edgeZero = await api("POST", `/orders/${ORDER_ID}/pickups`, {
    items: [{ orderItemId: shirtItemId, quantity: 0 }],
  });
  check("Rejected for zero quantity (400)", edgeZero.status === 400,
    `got ${edgeZero.status} — ${JSON.stringify(edgeZero.data?.error ?? "").slice(0, 60)}`);

  // ─── 10. RECORD PAYMENT (for full completion test) ────
  console.log("\n▸ Step 10: Record full payment");
  const payRes = await api("POST", `/orders/${ORDER_ID}/payments`, {
    amount: totalExpected,
    method: "cash",
  });
  check("Payment recorded (201)", payRes.status === 201, `got ${payRes.status}`);

  // ─── 11. FINAL PICKUP — ALL REMAINING ─────────────────
  console.log("\n▸ Step 11: Final Pickup — all remaining items (3 Shirts, 2 Trousers, 2 Bedsheets)");
  const p2Res = await api("POST", `/orders/${ORDER_ID}/pickups`, {
    items: [
      { orderItemId: shirtItemId,    quantity: 3 },
      { orderItemId: trouserItemId,  quantity: 2 },
      { orderItemId: bedsheetItemId, quantity: 2 },
    ],
    notes: "Customer collected all remaining items",
  });
  check("Final pickup recorded (200/201)", [200, 201].includes(p2Res.status), `got ${p2Res.status}`);
  if (![200,201].includes(p2Res.status)) console.log("  Error:", JSON.stringify(p2Res.data));

  // ─── 12. VERIFY COMPLETION ────────────────────────────
  console.log("\n▸ Step 12: Verify final state");
  const order12 = await api("GET", `/orders/${ORDER_ID}`);
  const o12 = order12.data;
  check("Status=completed", o12.status === "completed", `got ${o12.status}`);
  const shirtFinal    = o12.items.find(i => i.name?.includes("Shirt"));
  const trouserFinal  = o12.items.find(i => i.name?.includes("Trouser"));
  const bedsheetFinal = o12.items.find(i => i.name?.includes("Bedsheet"));
  check("Shirt: all 5 picked up", shirtFinal?.quantityPickedUp === 5, `got ${shirtFinal?.quantityPickedUp}`);
  check("Trouser: all 3 picked up", trouserFinal?.quantityPickedUp === 3, `got ${trouserFinal?.quantityPickedUp}`);
  check("Bedsheet: all 2 picked up", bedsheetFinal?.quantityPickedUp === 2, `got ${bedsheetFinal?.quantityPickedUp}`);
  check("No remaining items > 0",
    [shirtFinal, trouserFinal, bedsheetFinal].every(i => (i?.quantity - i?.quantityPickedUp) === 0));
  check("No negative quantities",
    [shirtFinal, trouserFinal, bedsheetFinal].every(i => (i?.quantity - i?.quantityPickedUp) >= 0));

  // ─── 13. PICKUP HISTORY ───────────────────────────────
  console.log("\n▸ Step 13: Pickup history");
  const pickups13 = await api("GET", `/orders/${ORDER_ID}/pickups`);
  check("History has 2 records", pickups13.data?.length === 2, `got ${pickups13.data?.length}`);
  console.log(`  ${INFO} Pickup 1:`, JSON.stringify(pickups13.data?.[0]?.items ?? []).slice(0, 100));
  console.log(`  ${INFO} Pickup 2:`, JSON.stringify(pickups13.data?.[1]?.items ?? []).slice(0, 100));

  // ─── 14. EDGE CASE: PICKUP AFTER COMPLETED ────────────
  console.log("\n▸ Step 14: Edge case — Pickup after order completed");
  const edgeComplete = await api("POST", `/orders/${ORDER_ID}/pickups`, {
    items: [{ orderItemId: shirtItemId, quantity: 1 }],
  });
  check("Rejected after completion (400/422)",
    [400, 422].includes(edgeComplete.status),
    `got ${edgeComplete.status} — ${JSON.stringify(edgeComplete.data?.error ?? edgeComplete.data).slice(0, 80)}`);

  // ─── 15. AUDIT LOG ────────────────────────────────────
  console.log("\n▸ Step 15: Audit log");
  const audit = await api("GET", `/orders/${ORDER_ID}/audit-log`);
  const auditActions = audit.data?.map(e => e.action) ?? [];
  check("order_created in audit", auditActions.includes("order_created"));
  check("pickup_partial in audit", auditActions.some(a => a.includes("pickup")));
  console.log(`  ${INFO} Audit actions: ${auditActions.join(", ")}`);

  // ─── 16. CUSTOMER STATEMENT ───────────────────────────
  console.log("\n▸ Step 16: Customer statement");
  const custRes = await api("GET", `/orders/${ORDER_ID}`);
  const custId = custRes.data?.customerId;
  if (custId) {
    const stmt = await api("GET", `/customers/${custId}/statement`);
    check("Statement returns 200", stmt.status === 200, `got ${stmt.status}`);
    const stmtEntries = stmt.data?.entries ?? [];
    check("Statement has entries", stmtEntries.length > 0, `got ${stmtEntries.length}`);
    console.log(`  ${INFO} Statement entries: ${stmtEntries.length}`);
  } else {
    console.log(`  ${INFO} Guest customer (no customerId) — statement skipped`);
  }

  // ─── SUMMARY ──────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════");
  const exitCode = process.exitCode || 0;
  if (exitCode === 0) {
    console.log("  ✅ ALL CHECKS PASSED — Partial pickup is production-safe");
  } else {
    console.log("  ❌ SOME CHECKS FAILED — See above for details");
  }
  console.log("══════════════════════════════════════════════\n");

  // Cleanup: delete the test order
  const del = await api("DELETE", `/orders/${ORDER_ID}`);
  console.log(`  🧹 Cleanup: test order deleted (${del.status})`);
}

run().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
