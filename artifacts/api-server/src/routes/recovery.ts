import { Router } from "express";
import { db } from "@workspace/db";
import { workers, customers, branches, paymentRecords, orders } from "@workspace/db/schema";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { logAction } from "../lib/audit.js";

export const recoveryRouter = Router();

recoveryRouter.get("/summary", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const [
      deletedWorkers,
      deletedCustomers,
      deletedBranches,
      deletedPayments,
    ] = await Promise.all([
      db.select().from(workers).where(and(eq(workers.laundryId, laundryId), isNotNull(workers.deletedAt))),
      db.select().from(customers).where(and(eq(customers.laundryId, laundryId), isNotNull(customers.deletedAt))),
      db.select().from(branches).where(and(eq(branches.laundryId, laundryId), isNotNull(branches.deletedAt))),
      db.select().from(paymentRecords).where(and(eq(paymentRecords.laundryId, laundryId), isNotNull(paymentRecords.deletedAt))),
    ]);

    res.json({
      workers: deletedWorkers.length,
      customers: deletedCustomers.length,
      branches: deletedBranches.length,
      payments: deletedPayments.length,
      total: deletedWorkers.length + deletedCustomers.length + deletedBranches.length + deletedPayments.length,
    });
  } catch {
    res.status(500).json({ error: "Failed to get recovery summary" });
  }
});

recoveryRouter.get("/workers", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select({
      id: workers.id,
      name: workers.name,
      phone: workers.phone,
      role: workers.role,
      branchId: workers.branchId,
      deletedAt: workers.deletedAt,
      deletedByName: workers.deletedByName,
      deletedByType: workers.deletedByType,
      createdAt: workers.createdAt,
    }).from(workers)
      .where(and(eq(workers.laundryId, laundryId), isNotNull(workers.deletedAt)))
      .orderBy(desc(workers.deletedAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list deleted workers" });
  }
});

recoveryRouter.post("/workers/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid worker ID" });

    const [existing] = await db.select().from(workers)
      .where(and(eq(workers.id, id), eq(workers.laundryId, laundryId), isNotNull(workers.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Deleted worker not found" });

    await db.update(workers).set({
      isActive: true,
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
      updatedAt: new Date(),
    }).where(eq(workers.id, id));

    logAction({
      auth: req.auth!,
      laundryId,
      action: "worker_restored",
      metadata: { workerId: id, workerName: existing.name },
    }).catch(() => {});

    res.json({ id, name: existing.name, restored: true });
  } catch {
    res.status(500).json({ error: "Failed to restore worker" });
  }
});

recoveryRouter.get("/customers", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select({
      id: customers.id,
      fullName: customers.fullName,
      phone: customers.phone,
      branchId: customers.branchId,
      deletedAt: customers.deletedAt,
      deletedByName: customers.deletedByName,
      deletedByType: customers.deletedByType,
      createdAt: customers.createdAt,
    }).from(customers)
      .where(and(eq(customers.laundryId, laundryId), isNotNull(customers.deletedAt)))
      .orderBy(desc(customers.deletedAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list deleted customers" });
  }
});

recoveryRouter.post("/customers/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid customer ID" });

    const [existing] = await db.select().from(customers)
      .where(and(eq(customers.id, id), eq(customers.laundryId, laundryId), isNotNull(customers.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Deleted customer not found" });

    await db.update(customers).set({
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
    }).where(eq(customers.id, id));

    logAction({
      auth: req.auth!,
      laundryId,
      action: "customer_restored",
      metadata: { customerId: id, fullName: existing.fullName, phone: existing.phone },
    }).catch(() => {});

    res.json({ id, fullName: existing.fullName, restored: true });
  } catch {
    res.status(500).json({ error: "Failed to restore customer" });
  }
});

recoveryRouter.get("/branches", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select({
      id: branches.id,
      name: branches.name,
      address: branches.address,
      deletedAt: branches.deletedAt,
      deletedByName: branches.deletedByName,
      deletedByType: branches.deletedByType,
      createdAt: branches.createdAt,
    }).from(branches)
      .where(and(eq(branches.laundryId, laundryId), isNotNull(branches.deletedAt)))
      .orderBy(desc(branches.deletedAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list deleted branches" });
  }
});

recoveryRouter.post("/branches/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid branch ID" });

    const [existing] = await db.select().from(branches)
      .where(and(eq(branches.id, id), eq(branches.laundryId, laundryId), isNotNull(branches.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Deleted branch not found" });

    await db.update(branches).set({
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
    }).where(eq(branches.id, id));

    logAction({
      auth: req.auth!,
      laundryId,
      action: "branch_restored",
      metadata: { branchId: id, branchName: existing.name },
    }).catch(() => {});

    res.json({ id, name: existing.name, restored: true });
  } catch {
    res.status(500).json({ error: "Failed to restore branch" });
  }
});

recoveryRouter.get("/payments", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await db.select({
      id: paymentRecords.id,
      orderId: paymentRecords.orderId,
      receiptNumber: paymentRecords.receiptNumber,
      amount: paymentRecords.amount,
      method: paymentRecords.method,
      recordedBy: paymentRecords.recordedBy,
      recordedAt: paymentRecords.recordedAt,
      deletedAt: paymentRecords.deletedAt,
      deletedByName: paymentRecords.deletedByName,
      deletedByType: paymentRecords.deletedByType,
    }).from(paymentRecords)
      .where(and(eq(paymentRecords.laundryId, laundryId), isNotNull(paymentRecords.deletedAt)))
      .orderBy(desc(paymentRecords.deletedAt));
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to list voided payments" });
  }
});

recoveryRouter.post("/payments/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid payment ID" });

    const [existing] = await db.select().from(paymentRecords)
      .where(and(eq(paymentRecords.id, id), eq(paymentRecords.laundryId, laundryId), isNotNull(paymentRecords.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Voided payment not found" });

    await db.update(paymentRecords).set({
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
      deletionReason: null,
    }).where(eq(paymentRecords.id, id));

    const [order] = await db.select().from(orders).where(eq(orders.id, existing.orderId));
    if (order) {
      const remaining = await db.select().from(paymentRecords)
        .where(and(eq(paymentRecords.orderId, order.id), isNull(paymentRecords.deletedAt)));
      const newAmountPaid = remaining.reduce((sum, p) => sum + parseFloat(p.amount), 0);
      const totalDue = parseFloat(order.price || "0") + parseFloat(order.extraCharge || "0") - parseFloat(order.discount || "0");
      const newPaymentStatus = totalDue <= 0 || newAmountPaid >= totalDue ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid";
      await db.update(orders).set({
        amountPaid: newAmountPaid.toString(),
        paymentStatus: newPaymentStatus as "unpaid" | "partial" | "paid",
        updatedAt: new Date(),
      }).where(eq(orders.id, order.id));
    }

    logAction({
      auth: req.auth!,
      laundryId,
      action: "payment_restored",
      orderId: existing.orderId,
      metadata: { paymentId: id, receiptNumber: existing.receiptNumber, amount: existing.amount },
    }).catch(() => {});

    res.json({ id, receiptNumber: existing.receiptNumber, amount: existing.amount, restored: true });
  } catch {
    res.status(500).json({ error: "Failed to restore payment" });
  }
});
