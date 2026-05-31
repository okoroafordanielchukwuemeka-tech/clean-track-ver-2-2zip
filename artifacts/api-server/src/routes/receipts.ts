import { Router } from "express";
import { db } from "@workspace/db";
import { orders, paymentRecords, orderItems, customers, laundries, priceAdjustments, branches, workers } from "@workspace/db/schema";
import { eq, desc, and, count, ilike, or, gte, lte, sql } from "drizzle-orm";
import { AuthRequest, requireOwner } from "../middleware/auth.js";

export const receiptsRouter = Router();

// Owner-only: full receipt list with financial totals.
// Workers are blocked here; they access receipts via GET /customers/:id/receipts or GET /orders/:id/receipt.
receiptsRouter.get("/", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { search, dateRange, from, to, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions: any[] = [eq(paymentRecords.laundryId, laundryId)];

    if (search) {
      const s = `%${search}%`;
      conditions.push(
        or(
          ilike(paymentRecords.receiptNumber as any, s),
          ilike(orders.customerName, s),
          ilike(orders.phone, s),
          ilike(orders.orderId, s),
        )
      );
    }

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (dateRange === "today") {
      startDate = new Date(); startDate.setHours(0, 0, 0, 0);
      endDate = new Date(); endDate.setHours(23, 59, 59, 999);
    } else if (dateRange === "7days") {
      startDate = new Date(Date.now() - 7 * 86400000);
    } else if (dateRange === "30days") {
      startDate = new Date(Date.now() - 30 * 86400000);
    } else if (dateRange === "custom" && from) {
      startDate = new Date(from);
      if (to) endDate = new Date(to);
    }

    if (startDate) conditions.push(gte(paymentRecords.recordedAt, startDate));
    if (endDate) conditions.push(lte(paymentRecords.recordedAt, endDate));

    const whereClause = and(...conditions);

    const [rows, [{ total }], [totals]] = await Promise.all([
      db
        .select({
          id: paymentRecords.id,
          receiptNumber: paymentRecords.receiptNumber,
          orderId: orders.id,
          orderRef: orders.orderId,
          customerName: orders.customerName,
          phone: orders.phone,
          customerId: orders.customerId,
          amount: paymentRecords.amount,
          method: paymentRecords.method,
          remainingBalance: paymentRecords.remainingBalance,
          recordedBy: paymentRecords.recordedBy,
          recordedAt: paymentRecords.recordedAt,
          paymentStatus: orders.paymentStatus,
        })
        .from(paymentRecords)
        .innerJoin(orders, eq(paymentRecords.orderId, orders.id))
        .where(whereClause)
        .orderBy(desc(paymentRecords.recordedAt))
        .limit(parseInt(limit))
        .offset(parseInt(offset)),
      db
        .select({ total: count() })
        .from(paymentRecords)
        .innerJoin(orders, eq(paymentRecords.orderId, orders.id))
        .where(whereClause),
      db
        .select({
          totalCollected: sql<string>`COALESCE(SUM(${paymentRecords.amount}), 0)`,
          totalBalance: sql<string>`COALESCE((
            SELECT SUM(balance) FROM (
              SELECT DISTINCT ON (o.id)
                GREATEST(0, o.price::numeric + COALESCE(o.extra_charge, 0)::numeric - COALESCE(o.discount, 0)::numeric - o.amount_paid::numeric) AS balance
              FROM payment_records pr
              INNER JOIN orders o ON pr.order_id = o.id
              WHERE ${sql.raw(`pr.laundry_id = ${laundryId}`)}
                AND o.payment_status != 'paid'
                ${startDate ? sql.raw(`AND pr.recorded_at >= '${startDate.toISOString()}'`) : sql.raw("")}
                ${endDate ? sql.raw(`AND pr.recorded_at <= '${endDate.toISOString()}'`) : sql.raw("")}
            ) AS distinct_orders
          ), 0)`,
        })
        .from(paymentRecords)
        .innerJoin(orders, eq(paymentRecords.orderId, orders.id))
        .where(whereClause),
    ]);

    res.json({
      receipts: rows,
      total: total,
      totalCollected: parseFloat(totals?.totalCollected ?? "0"),
      totalBalance: Math.max(0, parseFloat(totals?.totalBalance ?? "0")),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list receipts" });
  }
});

receiptsRouter.get("/:receiptNumber", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const { receiptNumber } = req.params;

    const [payment] = await db
      .select()
      .from(paymentRecords)
      .where(
        and(
          eq(paymentRecords.receiptNumber, receiptNumber),
          eq(paymentRecords.laundryId, laundryId),
        )
      );

    if (!payment) return res.status(404).json({ error: "Receipt not found" });

    const orderConditions: any[] = [eq(orders.id, payment.orderId)];
    if (workerBranchId) orderConditions.push(eq(orders.branchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...orderConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const [laundry] = await db.select().from(laundries).where(eq(laundries.id, laundryId));
    const [customer] = order.customerId
      ? await db.select().from(customers).where(eq(customers.id, order.customerId))
      : [null];

    const [items, adjustments, allPayments] = await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
      db.select().from(priceAdjustments).where(eq(priceAdjustments.orderId, order.id)).orderBy(priceAdjustments.createdAt),
      db.select().from(paymentRecords).where(eq(paymentRecords.orderId, order.id)).orderBy(paymentRecords.recordedAt),
    ]);

    const [branch, cashierWorker] = await Promise.all([
      order.branchId
        ? db.select().from(branches).where(eq(branches.id, order.branchId)).then(r => r[0] ?? null)
        : Promise.resolve(null),
      payment.workerId
        ? db.select({ name: workers.name }).from(workers).where(eq(workers.id, payment.workerId)).then(r => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    const businessProfile = (laundry?.businessProfile ?? {}) as Record<string, string>;
    const brandingSettings = (laundry?.brandingSettings ?? {}) as Record<string, string>;

    const basePrice = parseFloat(order.price || "0");
    const extraCharge = parseFloat(order.extraCharge || "0");
    const discount = parseFloat(order.discount || "0");
    const totalDue = basePrice + extraCharge - discount;
    const amountPaid = parseFloat(order.amountPaid || "0");
    const balance = Math.max(0, totalDue - amountPaid);

    res.json({
      receipt: {
        receiptNumber: payment.receiptNumber,
        recordedAt: payment.recordedAt,
        amount: parseFloat(payment.amount),
        method: payment.method,
        notes: payment.notes,
        remainingBalance: parseFloat(payment.remainingBalance),
        recordedBy: payment.recordedBy,
        cashierName: cashierWorker?.name ?? payment.recordedBy ?? null,
      },
      laundry: {
        businessName: laundry?.businessName ?? "",
        phone: laundry?.phone ?? "",
        address: businessProfile.address ?? "",
        email: businessProfile.email ?? "",
        logoUrl: businessProfile.logoUrl ?? "",
        receiptHeaderName: brandingSettings.receiptHeaderName ?? laundry?.businessName ?? "",
        receiptFooterText: brandingSettings.receiptFooterText ?? "",
        brandColor: brandingSettings.brandColor ?? "",
      },
      branch: branch ? {
        id: branch.id,
        name: branch.name,
        address: branch.address ?? "",
      } : null,
      customer: {
        fullName: order.customerName,
        phone: order.phone,
        address: order.address ?? customer?.address ?? "",
      },
      order: {
        id: order.id,
        orderId: order.orderId,
        branchId: order.branchId,
        serviceType: order.serviceType,
        shirts: order.shirts,
        trousers: order.trousers,
        status: order.status,
        paymentStatus: order.paymentStatus,
        additionalNotes: order.additionalNotes,
        createdAt: order.createdAt,
      },
      items,
      priceAdjustments: adjustments,
      pricing: {
        basePrice,
        extraCharge,
        discount,
        totalDue,
        amountPaid,
        balance,
      },
      allPayments: allPayments.map(p => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        amount: parseFloat(p.amount),
        method: p.method,
        recordedBy: p.recordedBy,
        recordedAt: p.recordedAt,
        remainingBalance: parseFloat(p.remainingBalance),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get receipt" });
  }
});
