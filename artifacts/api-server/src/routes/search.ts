import { Router } from "express";
import { db } from "@workspace/db";
import {
  customers,
  orders,
  paymentRecords,
  workers,
  services,
  branches,
} from "@workspace/db/schema";
import { eq, and, ilike, isNull, or, SQL } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";

export const searchRouter = Router();

/** Returns the effective branchId: worker's own branch, owner's ?branchId param, or null = all */
function getEffectiveBranchId(req: AuthRequest): number | null {
  if (req.auth!.branchId) return req.auth!.branchId;
  const param = (req.query as any).branchId;
  return param ? parseInt(param as string, 10) : null;
}

searchRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const q = ((req.query as any).q as string | undefined ?? "").trim();
    const isOwner = req.auth!.type === "owner";

    if (q.length < 2) {
      return res.json({
        customers: [],
        orders: [],
        receipts: [],
        workers: [],
        services: [],
        branches: [],
      });
    }

    const effectiveBranchId = getEffectiveBranchId(req);
    const pattern = `%${q}%`;
    const LIMIT = 5;

    // ── Customers ──────────────────────────────────────────────────────────
    const customerConds: SQL[] = [
      eq(customers.laundryId, laundryId),
      isNull(customers.deletedAt),
    ];
    const customerTextMatch = or(
      ilike(customers.fullName, pattern),
      ilike(customers.phone, pattern)
    );
    if (customerTextMatch) customerConds.push(customerTextMatch);
    if (effectiveBranchId) customerConds.push(eq(customers.branchId, effectiveBranchId));

    const customerRows = await db
      .select({
        id: customers.id,
        fullName: customers.fullName,
        phone: customers.phone,
        branchId: customers.branchId,
      })
      .from(customers)
      .where(and(...customerConds))
      .limit(LIMIT);

    // ── Orders ─────────────────────────────────────────────────────────────
    const orderConds: SQL[] = [eq(orders.laundryId, laundryId)];
    const orderTextMatch = or(
      ilike(orders.orderId, pattern),
      ilike(orders.customerName, pattern)
    );
    if (orderTextMatch) orderConds.push(orderTextMatch);
    if (effectiveBranchId) orderConds.push(eq(orders.branchId, effectiveBranchId));

    const orderRows = await db
      .select({
        id: orders.id,
        orderId: orders.orderId,
        customerName: orders.customerName,
        status: orders.status,
      })
      .from(orders)
      .where(and(...orderConds))
      .limit(LIMIT);

    // ── Receipts (receipt numbers live on paymentRecords) ──────────────────
    const receiptConds: SQL[] = [
      isNull(paymentRecords.deletedAt),
      ilike(paymentRecords.receiptNumber, pattern),
    ];
    // paymentRecords.laundryId may be null for very old records — filter by
    // branchId first (always set) and fall back to laundryId when available.
    if (effectiveBranchId) {
      receiptConds.push(eq(paymentRecords.branchId, effectiveBranchId));
    } else {
      receiptConds.push(eq(paymentRecords.laundryId, laundryId));
    }

    const receiptRows = await db
      .select({
        id: paymentRecords.id,
        receiptNumber: paymentRecords.receiptNumber,
        amount: paymentRecords.amount,
        orderId: paymentRecords.orderId,
      })
      .from(paymentRecords)
      .where(and(...receiptConds))
      .limit(LIMIT);

    // ── Workers (owner-only) ───────────────────────────────────────────────
    let workerRows: Array<{
      id: number;
      name: string;
      phone: string | null;
      branchId: number | null;
    }> = [];
    if (isOwner) {
      const workerConds: SQL[] = [
        eq(workers.laundryId, laundryId),
        isNull(workers.deletedAt),
        ilike(workers.name, pattern),
      ];
      if (effectiveBranchId) workerConds.push(eq(workers.branchId, effectiveBranchId));

      workerRows = await db
        .select({
          id: workers.id,
          name: workers.name,
          phone: workers.phone,
          branchId: workers.branchId,
        })
        .from(workers)
        .where(and(...workerConds))
        .limit(LIMIT);
    }

    // ── Services (owner-only; no archived column — isActive is the gate) ───
    let serviceRows: Array<{ id: number; name: string; category: string }> = [];
    if (isOwner) {
      serviceRows = await db
        .select({ id: services.id, name: services.name, category: services.category })
        .from(services)
        .where(and(eq(services.laundryId, laundryId), ilike(services.name, pattern)))
        .limit(LIMIT);
    }

    // ── Branches (owner-only) ──────────────────────────────────────────────
    let branchRows: Array<{ id: number; name: string; address: string | null }> = [];
    if (isOwner) {
      branchRows = await db
        .select({ id: branches.id, name: branches.name, address: branches.address })
        .from(branches)
        .where(
          and(
            eq(branches.laundryId, laundryId),
            isNull(branches.deletedAt),
            ilike(branches.name, pattern)
          )
        )
        .limit(LIMIT);
    }

    return res.json({
      customers: customerRows,
      orders: orderRows,
      receipts: receiptRows,
      workers: workerRows,
      services: serviceRows,
      branches: branchRows,
    });
  } catch (err) {
    console.error("[search] Error:", err);
    return res.status(500).json({ error: "Search failed" });
  }
});
