#!/usr/bin/env node
/**
 * CleanTrack — WhatsApp Webhook Signature Verification Test
 *
 * Tests the X-Hub-Signature-256 enforcement on POST /api/webhooks/whatsapp.
 * Requires the API server to be running (DATABASE_URL + server on port 3001).
 *
 * Usage:
 *   node scripts/test-webhook-signature.mjs
 *   WHATSAPP_APP_SECRET=<secret> node scripts/test-webhook-signature.mjs
 *
 * When WHATSAPP_APP_SECRET is not set in the environment that is running
 * the *server*, all signed and unsigned requests will be rejected (fail-closed).
 * This script simulates both cases.
 */

import crypto from "crypto";

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
const SECRET = process.env.WHATSAPP_APP_SECRET ?? "";

const PAYLOAD = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "12345678901234" },
            statuses: [],
          },
        },
      ],
    },
  ],
});

function computeSig(secret, payload) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(Buffer.from(payload, "utf8")).digest("hex");
}

async function req(headers, body = PAYLOAD) {
  const res = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  return res.status;
}

let PASS = 0;
let FAIL = 0;

function check(label, got, expected) {
  if (got === expected) {
    console.log(`  ✓ ${label} (HTTP ${got})`);
    PASS++;
  } else {
    console.log(`  ✗ ${label} — expected HTTP ${expected}, got HTTP ${got}`);
    FAIL++;
  }
}

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║   WhatsApp Webhook Signature Verification Tests      ║");
console.log("╚══════════════════════════════════════════════════════╝");
console.log(`\n  API: ${BASE_URL}`);
console.log(`  Secret configured: ${SECRET ? "YES (via WHATSAPP_APP_SECRET)" : "NO"}\n`);

// Test 1: No signature header → always 403
const noSig = await req({});
check("No X-Hub-Signature-256 header → 403", noSig, 403);

// Test 2: Malformed signature (not sha256=...) → 403
const badFormat = await req({ "X-Hub-Signature-256": "notvalid" });
check("Malformed signature (no sha256= prefix) → 403", badFormat, 403);

// Test 3: Wrong signature value → 403
const wrongSig = await req({ "X-Hub-Signature-256": "sha256=" + "0".repeat(64) });
check("All-zeros signature (mismatch or no secret) → 403", wrongSig, 403);

if (SECRET) {
  // Test 4: Valid signature with correct secret → 200
  const goodSig = computeSig(SECRET, PAYLOAD);
  const validReq = await req({ "X-Hub-Signature-256": goodSig });
  check("Valid signature with correct secret → 200", validReq, 200);

  // Test 5: Valid signature format but wrong secret → 403
  const badSecretSig = computeSig("wrong-secret-entirely", PAYLOAD);
  const badSecretReq = await req({ "X-Hub-Signature-256": badSecretSig });
  check("Valid format but wrong secret → 403", badSecretReq, 403);

  // Test 6: Tampered payload (signature computed over different body) → 403
  const tamperedSig = computeSig(SECRET, PAYLOAD);
  const tamperedReq = await req({ "X-Hub-Signature-256": tamperedSig }, PAYLOAD + " ");
  check("Tampered payload (extra space) → 403", tamperedReq, 403);
} else {
  console.log("  ~ Skipping secret-dependent tests (WHATSAPP_APP_SECRET not set)");
  console.log("    Set WHATSAPP_APP_SECRET matching the server's secret to run all tests.");
}

// Test 7: GET challenge endpoint unaffected
const getRes = await fetch(
  `${BASE_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=badtoken&hub.challenge=abc`
);
check("GET challenge (bad token) → 403, endpoint still works", getRes.status, 403);

console.log(`\n══════════════════════════════════════════════════════`);
console.log(`  Results: ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  console.log("  STATUS: FAILED");
  process.exit(1);
} else {
  console.log("  STATUS: PASSED");
}
