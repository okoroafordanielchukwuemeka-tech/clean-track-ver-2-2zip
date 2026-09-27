/**
 * Gate 1 integration verification for worker multi-branch access.
 *
 * Safety:
 * - This script NEVER chooses DATABASE_URL automatically.
 * - It requires CLEANTRACK_GATE1_TEST_DATABASE_URL.
 * - It refuses to run against obvious production/Railway URLs.
 *
 * Run only against an isolated test database where migration 0008 has already
 * been applied.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";

const testDatabaseUrl = process.env.CLEANTRACK_GATE1_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    "Set CLEANTRACK_GATE1_TEST_DATABASE_URL to an isolated test database before running Gate 1 integration tests.",
  );
}

if (/railway|production/i.test(testDatabaseUrl)) {
  throw new Error("Refusing to run Gate 1 integration tests against a production/Railway URL.");
}

process.env.DATABASE_URL = testDatabaseUrl;
delete process.env.EXTERNAL_DATABASE_URL;

const { db, pool } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const { laundries, branches, workers, orders, workerBranchAccess } =
  await import("@workspace/db/schema");
const {
  getWorkerAllowedBranchIds,
  grantWorkerBranchAccess,
  revokeWorkerBranchAccess,
} = await import("../artifacts/api-server/src/lib/worker-branch-access.js");

const suffix = crypto.randomUUID();
const passwordHash = "gate-1-test";
let laundryAId: number | undefined;
let laundryBId: number | undefined;
let workerId: number | undefined;
let orderId: number | undefined;

try {
  const [laundryA] = await db.insert(laundries).values({
    businessName: `Gate 1 Test A ${suffix}`,
    ownerEmail: `gate1-a-${suffix}@test.local`,
    passwordHash,
  }).returning({ id: laundries.id });
  const [laundryB] = await db.insert(laundries).values({
    businessName: `Gate 1 Test B ${suffix}`,
    ownerEmail: `gate1-b-${suffix}@test.local`,
    passwordHash,
  }).returning({ id: laundries.id });

  laundryAId = laundryA.id;
  laundryBId = laundryB.id;

  const branchRows = await db.insert(branches).values([
    { laundryId: laundryAId, name: "A" },
    { laundryId: laundryAId, name: "B" },
    { laundryId: laundryAId, name: "C" },
    { laundryId: laundryAId, name: "D" },
    { laundryId: laundryBId, name: "Foreign" },
  ]).returning({ id: branches.id, name: branches.name });

  const branchAId = branchRows.find((b) => b.name === "A")!.id;
  const branchBId = branchRows.find((b) => b.name === "B")!.id;
  const branchCId = branchRows.find((b) => b.name === "C")!.id;
  const branchDId = branchRows.find((b) => b.name === "D")!.id;
  const foreignBranchId = branchRows.find((b) => b.name === "Foreign")!.id;

  const [worker] = await db.insert(workers).values({
    laundryId: laundryAId,
    branchId: branchAId,
    name: "Gate 1 Worker",
    role: "worker",
  }).returning({ id: workers.id });
  workerId = worker.id;

  const [order] = await db.insert(orders).values({
    laundryId: laundryAId,
    branchId: branchAId,
    orderId: `GATE1-${suffix}`,
    customerName: "Gate 1 Customer",
    phone: "08000000000",
  }).returning({ id: orders.id });
  orderId = order.id;

  // 1. Primary only => [A]
  assert.deepEqual(await getWorkerAllowedBranchIds(workerId, laundryAId), [branchAId]);

  // 2. Primary + B => [A, B]
  assert.equal(await grantWorkerBranchAccess(workerId, laundryAId, branchBId), true);
  assert.deepEqual(await getWorkerAllowedBranchIds(workerId, laundryAId), [branchAId, branchBId]);

  // 3. Primary + B + C => [A, B, C]
  assert.equal(await grantWorkerBranchAccess(workerId, laundryAId, branchCId), true);
  assert.deepEqual(await getWorkerAllowedBranchIds(workerId, laundryAId), [branchAId, branchBId, branchCId]);

  // 4. Duplicate primary and duplicate additional access do not duplicate rows.
  assert.equal(await grantWorkerBranchAccess(workerId, laundryAId, branchAId), false);
  assert.equal(await grantWorkerBranchAccess(workerId, laundryAId, branchBId), false);
  assert.equal((await db.select({ id: workerBranchAccess.id }).from(workerBranchAccess)).length, 2);

  // 5. Cross-tenant grant is rejected and creates no row.
  await assert.rejects(
    () => grantWorkerBranchAccess(workerId, laundryAId, foreignBranchId),
    /same laundry/i,
  );
  assert.equal((await db.select({ id: workerBranchAccess.id }).from(workerBranchAccess)).length, 2);

  // 6. Revoke B => live resolution becomes A,C without relogin.
  assert.equal(await revokeWorkerBranchAccess(workerId, laundryAId, branchBId), true);
  assert.deepEqual(await getWorkerAllowedBranchIds(workerId, laundryAId), [branchAId, branchCId]);

  // 7. Primary A -> D does not move the existing order from A.
  await db.update(workers).set({ branchId: branchDId }).where(eq(workers.id, workerId));
  assert.deepEqual(await getWorkerAllowedBranchIds(workerId, laundryAId), [branchDId, branchCId]);
  const [unchangedOrder] = await db.select({ branchId: orders.branchId }).from(orders).where(eq(orders.id, orderId));
  assert.equal(unchangedOrder.branchId, branchAId);

  // 8. A manipulated cross-tenant access row is ignored by the resolver.
  await db.insert(workerBranchAccess).values({ workerId, branchId: foreignBranchId });
  assert.deepEqual(await getWorkerAllowedBranchIds(workerId, laundryAId), [branchDId, branchCId]);

  console.log("Gate 1 worker branch access integration tests: PASS");
} finally {
  if (orderId) await db.delete(orders).where(eq(orders.id, orderId));
  if (workerId) {
    await db.delete(workerBranchAccess).where(eq(workerBranchAccess.workerId, workerId));
    await db.delete(workers).where(eq(workers.id, workerId));
  }
  if (laundryAId) await db.delete(branches).where(eq(branches.laundryId, laundryAId));
  if (laundryBId) await db.delete(branches).where(eq(branches.laundryId, laundryBId));
  if (laundryAId) await db.delete(laundries).where(eq(laundries.id, laundryAId));
  if (laundryBId) await db.delete(laundries).where(eq(laundries.id, laundryBId));
  await pool.end();
}
