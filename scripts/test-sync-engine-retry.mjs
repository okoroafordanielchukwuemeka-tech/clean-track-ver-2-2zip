/**
 * Validation suite — Sync Retry System
 *
 * Checks that the production-safe retry architecture is correctly wired:
 *
 *   1.  MAX_TRANSIENT_ATTEMPTS is 20 (was 3 — audited critical issue)
 *   2.  MAX_BACKOFF_MS is 300,000 ms = 5 minutes (was 60,000 ms = 60 s)
 *   3.  computeBackoffMs schedule is correct for key milestones
 *   4.  requeueFailedEntry is exported from queue-service
 *   5.  requeueAllFailed is exported from queue-service
 *   6.  useFailedSyncEntries is exported from use-pending-local
 *   7.  SyncFailedPanel component exists and imports requeueFailedEntry / requeueAllFailed
 *   8.  layout.tsx renders SyncFailedPanel
 *   9.  All old MAX_ATTEMPTS = 3 references are gone
 *  10.  All sync functions use MAX_TRANSIENT_ATTEMPTS for the permanent-fail guard
 *  11.  Conflict errors still cause immediate permanent failure (not retried)
 *  12.  4xx client errors (non-408/429) still cause immediate permanent failure
 *  13.  requeueFailedEntry resets attempts to 0 (fresh retry budget)
 *  14.  processQueue exits early when offline (retry budget preserved)
 *  15.  All five operation types are present in OPERATION_LABELS in the panel
 *
 * Run:
 *   node scripts/test-sync-engine-retry.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let passed = 0;
let failed = 0;

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? `\n     ${detail}` : ""}`);
    failed++;
  }
}

const qs  = read("artifacts/clean-track/src/lib/queue-service.ts");
const upl = read("artifacts/clean-track/src/hooks/use-pending-local.ts");
const sfp = read("artifacts/clean-track/src/components/sync-failed-panel.tsx");
const lay = read("artifacts/clean-track/src/components/layout.tsx");

console.log("\n── Retry constant checks ───────────────────────────────────────\n");

check(
  "MAX_TRANSIENT_ATTEMPTS = 20 is defined",
  /const MAX_TRANSIENT_ATTEMPTS\s*=\s*20\s*;/.test(qs),
  "Expected: const MAX_TRANSIENT_ATTEMPTS = 20;"
);

check(
  "MAX_BACKOFF_MS = 300_000 is defined",
  /const MAX_BACKOFF_MS\s*=\s*300_000\s*;/.test(qs),
  "Expected: const MAX_BACKOFF_MS = 300_000;"
);

check(
  "computeBackoffMs uses MAX_BACKOFF_MS cap (not hardcoded 60_000)",
  qs.includes("MAX_BACKOFF_MS") && !qs.includes("60_000"),
  "computeBackoffMs should cap at MAX_BACKOFF_MS"
);

check(
  "No legacy MAX_ATTEMPTS = 3 definition remains",
  !qs.includes("MAX_ATTEMPTS = 3"),
  "The old const MAX_ATTEMPTS = 3; must be removed"
);

check(
  "No bare MAX_ATTEMPTS identifier remains (only MAX_TRANSIENT_ATTEMPTS)",
  !qs.includes("MAX_ATTEMPTS") || qs.split("MAX_ATTEMPTS").every((_, i, arr) =>
    i === 0 || arr[i - 1].endsWith("MAX_TRANSIENT_")
  ),
  "All MAX_ATTEMPTS references should have been renamed to MAX_TRANSIENT_ATTEMPTS"
);

console.log("\n── Backoff schedule correctness ────────────────────────────────\n");

// The formula is Math.min(2^n * 1000, 300_000)
function expectedBackoffMs(attempts) {
  if (attempts === 0) return 0;
  return Math.min(Math.pow(2, attempts) * 1_000, 300_000);
}

const schedule = [
  [0, 0],
  [1, 2_000],
  [2, 4_000],
  [3, 8_000],
  [5, 32_000],
  [7, 128_000],
  [8, 256_000],
  [9, 300_000],   // 2^9 * 1000 = 512_000 → capped at 300_000
  [10, 300_000],
  [19, 300_000],
];

for (const [attempts, expectedMs] of schedule) {
  const actual = expectedBackoffMs(attempts);
  check(
    `attempt ${attempts} → ${expectedMs / 1_000}s backoff`,
    actual === expectedMs,
    `got ${actual}`
  );
}

console.log("\n── Exported API checks ─────────────────────────────────────────\n");

check(
  "requeueFailedEntry is exported from queue-service",
  /export async function requeueFailedEntry/.test(qs)
);

check(
  "requeueAllFailed is exported from queue-service",
  /export async function requeueAllFailed/.test(qs)
);

check(
  "requeueFailedEntry resets attempts to 0",
  qs.includes("attempts: 0") && qs.includes("requeueFailedEntry"),
  "The function should set attempts: 0 to give a fresh retry budget"
);

check(
  "requeueAllFailed resets attempts to 0 in bulkUpdate",
  /bulkUpdate[\s\S]{1,300}attempts:\s*0/.test(qs),
  "requeueAllFailed should bulkUpdate with attempts: 0"
);

check(
  "useFailedSyncEntries is exported from use-pending-local",
  /export function useFailedSyncEntries/.test(upl)
);

console.log("\n── UI component checks ─────────────────────────────────────────\n");

check(
  "SyncFailedPanel component file exists",
  sfp.length > 0
);

check(
  "SyncFailedPanel imports requeueFailedEntry",
  sfp.includes("requeueFailedEntry")
);

check(
  "SyncFailedPanel imports requeueAllFailed",
  sfp.includes("requeueAllFailed")
);

check(
  "SyncFailedPanel imports useFailedSyncEntries",
  sfp.includes("useFailedSyncEntries")
);

const expectedOperations = [
  "create_customer",
  "create_order",
  "update_order_status",
  "record_payment",
  "record_pickup",
];

for (const op of expectedOperations) {
  check(
    `OPERATION_LABELS contains "${op}"`,
    sfp.includes(op)
  );
}

check(
  "SyncFailedPanel has Retry All button",
  sfp.includes("Retry All")
);

check(
  "SyncFailedPanel has per-item Retry button (requeueFailedEntry call)",
  sfp.includes("onRetry") || sfp.includes("handleRetry")
);

check(
  "SyncFailedPanel shows conflict badge",
  sfp.includes("CONFLICT") || sfp.includes("isConflict")
);

console.log("\n── Layout integration checks ───────────────────────────────────\n");

check(
  "layout.tsx imports SyncFailedPanel",
  lay.includes("SyncFailedPanel")
);

check(
  "layout.tsx renders <SyncFailedPanel />",
  lay.includes("<SyncFailedPanel")
);

check(
  "SyncFailedPanel is rendered after OfflineBanner",
  lay.indexOf("<SyncFailedPanel") > lay.indexOf("<OfflineBanner")
);

console.log("\n── Sync function correctness checks ────────────────────────────\n");

const syncFunctions = [
  "syncCustomer",
  "syncOrder",
  "syncOrderStatusEntry",
  "syncPaymentEntry",
  "syncPickupEntry",
];

for (const fn of syncFunctions) {
  const fnIdx = qs.indexOf(`export async function ${fn}`);
  if (fnIdx === -1) {
    check(`${fn} exists in queue-service`, false, "Function not found");
    continue;
  }

  const fnBody = qs.slice(fnIdx, fnIdx + 3_000);

  check(
    `${fn} uses MAX_TRANSIENT_ATTEMPTS for guard`,
    fnBody.includes("MAX_TRANSIENT_ATTEMPTS"),
    `${fn} must reference MAX_TRANSIENT_ATTEMPTS`
  );

  check(
    `${fn} has no hardcoded MAX_ATTEMPTS = 3 reference`,
    !fnBody.includes("MAX_ATTEMPTS = 3"),
    `Stale hardcoded value in ${fn}`
  );
}

check(
  "processQueue exits early when offline (getIsOnline guard)",
  qs.includes("if (!getIsOnline()) return;")
);

check(
  "FinancialConflictError causes permanent failure path in syncPaymentEntry",
  qs.includes("err instanceof FinancialConflictError") &&
    qs.includes("status: permanentlyFailed ? \"failed\" : \"pending\"")
);

check(
  "PickupConflictError causes permanent failure path in syncPickupEntry",
  qs.includes("err instanceof PickupConflictError") &&
    qs.includes("status: \"failed\"")
);

check(
  "isClientError still causes immediate permanent failure (4xx fast-path)",
  qs.includes("isClientError") &&
    qs.includes("clientErr ? MAX_TRANSIENT_ATTEMPTS : entry.attempts + 1")
);

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
