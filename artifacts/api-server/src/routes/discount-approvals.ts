import { Router } from "express";
import { db } from "@workspace/db";
import { discountApprovals, priceAdjustments, orders, laundries } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireAuth } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { logAction } from "../lib/audit.js";
import { emitEvent } from "../lib/events.js";

export const discountApprovalsRouter = Router();

discountApprovalsRouter.use(requireAuth);

discountApprovalsRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { status } = req.query;
    const workerBranchId = req.auth!.branchId;

    const baseConditions: any[] = [eq(discountApprovals.laundryId, laundryId)];
    if (status) baseConditions.push(eq(discountApprovals.status, status as "pending" | "approved" | "rejected"));

    let results = await db.select().from(discountApprovals)
      .where(and(...baseConditions))
      .orderBy(desc(discountApprovals.createdAt));

    // If worker, filter to only their branch's orders
    if (workerBranchId) {
      const branchOrders = await db.select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.laundryId, laundryId), eq(orders.branchId, workerBranchId)));
      const branchOrderIds = new Set(branchOrders.map(o => o.id));
      results = results.filter(r => branchOrderIds.has(r.orderId));
    }

    res.json(results);
  } catch {
    res.status(500).json({ error: "Failed to list discount approvals" });
  }
});

discountApprovalsRouter.get("/pending-count", checkPermission("approve:discount"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const results = await db.select().from(discountApprovals)
      .where(and(
        eq(discountApprovals.laundryId, laundryId),
        eq(discountApprovals.status, "pending"),
      ));
    res.json({ count: results.length });
  } catch {
    res.status(500).json({ error: "Failed to count pending approvals" });
  }
});

discountApprovalsRouter.patch("/:id", checkPermission("approve:discount"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const approvalId = parseInt(req.params.id);
    const schema = z.object({
      status: z.enum(["approved", "rejected"]),
    });
    const { status } = schema.parse(req.body);

    const [approval] = await db.select().from(discountApprovals)
      .where(and(
        eq(discountApprovals.id, approvalId),
        eq(discountApprovals.laundryId, laundryId),
        eq(discountApprovals.status, "pending"),
      ));
    if (!approval) {
      return res.status(404).json({ error: "Pending approval not found" });
    }

    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, approval.orderId), eq(orders.laundryId, laundryId)));
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const resolvedBy = req.auth!.name ?? req.auth!.email ?? "owner";
    const now = new Date();

    const [updated] = await db.update(discountApprovals).set({
      status,
      resolvedBy,
      resolvedAt: now,
    }).where(eq(discountApprovals.id, approvalId)).returning();

    if (status === "approved") {
      const discountAmount = parseFloat(approval.requestedDiscount);
      const currentDiscount = parseFloat(order.discount || "0");

      await db.insert(priceAdjustments).values({
        orderId: order.id,
        laundryId,
        type: "discount",
        amount: approval.requestedDiscount,
        reason: `${approval.reason} (approved by ${resolvedBy})`,
        appliedBy: approval.requestedByName,
      });

      await db.update(orders).set({
        discount: (currentDiscount + discountAmount).toString(),
        updatedAt: now,
      }).where(eq(orders.id, order.id));

      emitEvent({
        laundryId,
        eventType: "discount_approved",
        title: "Discount Approved",
        message: `Discount of ₦${discountAmount.toLocaleString()} approved for Order #${order.orderId} (${order.customerName}).`,
        severity: "success",
        relatedOrderId: order.id,
        targetType: "worker",
        targetWorkerId: approval.requestedBy ?? undefined,
      }).catch(() => {});

      logAction({
        auth: req.auth!,
        laundryId,
        action: "discount_approved",
        orderId: order.id,
        metadata: {
          approvalId,
          discountAmount,
          requestedBy: approval.requestedByName,
          orderId: order.orderId,
        },
      }).catch(() => {});
    } else {
      emitEvent({
        laundryId,
        eventType: "discount_rejected",
        title: "Discount Request Rejected",
        message: `Discount request of ₦${parseFloat(approval.requestedDiscount).toLocaleString()} for Order #${order.orderId} was rejected.`,
        severity: "warning",
        relatedOrderId: order.id,
        targetType: "worker",
        targetWorkerId: approval.requestedBy ?? undefined,
      }).catch(() => {});

      logAction({
        auth: req.auth!,
        laundryId,
        action: "discount_rejected",
        orderId: order.id,
        metadata: {
          approvalId,
          requestedDiscount: approval.requestedDiscount,
          requestedBy: approval.requestedByName,
          orderId: order.orderId,
        },
      }).catch(() => {});
    }

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: "Failed to update discount approval" });
  }
});
