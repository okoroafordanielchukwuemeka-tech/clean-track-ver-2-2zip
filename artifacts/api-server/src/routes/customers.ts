import { Router } from "express";
import { db } from "@workspace/db";
import { customers, orders, paymentRecords, pickupRecords, priceAdjustments, laundries } from "@workspace/db/schema";
import { idempotencyMiddleware } from "../lib/idempotency.js";
import { eq, and, desc, ilike, or, gte, lte, lt, inArray, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { requireOperational, requirePlanLimit } from "../middleware/subscription.js";
import { logAction } from "../lib/audit.js";
import { trackActivationEvent } from "../lib/activation-tracker.js";

export const customersRouter = Router();

const customerInputSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  address: z.string().optional(),
  notes: z.string().optional(),
  // Owners pass branchId to assign a customer to a specific branch.
  // Workers always use their own branchId from the JWT (branchId ignored even if sent).
  branchId: z.number().int().optional(),
});

const customerUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
});

function computeMetrics(customerOrders: any[]) {
  const totalOrders = customerOrders.length;
  const completedOrders = customerOrders.filter(o => o.status === "completed").length;
  const cancelledOrders = customerOrders.filter(o => o.status === "cancelled").length;
  const activeOrders = customerOrders.filter(o =>
    ["pending", "processing", "ready", "partial_pickup"].includes(o.status)
  ).length;

  const totalSpending = customerOrders.reduce((s, o) => {
    const price = parseFloat(o.price || "0");
    const extra = parseFloat(o.extraCharge || "0");
    const disc = parseFloat(o.discount || "0");
    return s + price + extra - disc;
  }, 0);

  const totalPaid = customerOrders.reduce((s, o) => s + parseFloat(o.amountPaid || "0"), 0);
  const outstandingBalance = Math.max(0, totalSpending - totalPaid);

  const avgOrderValue = totalOrders > 0 ? totalSpending / totalOrders : 0;

  const remainingItems = customerOrders
    .filter(o => ["ready", "partial_pickup"].includes(o.status))
    .reduce((s, o) => {
      const rShirts = Math.max(0, (o.shirts || 0) - (o.shirtsPickedUp || 0));
      const rTrousers = Math.max(0, (o.trousers || 0) - (o.trousersPickedUp || 0));
      return s + rShirts + rTrousers;
    }, 0);

  const sortedDates = customerOrders
    .map(o => o.createdAt)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  const lastOrderDate = sortedDates[0] || null;

  const isVip = totalSpending >= 50000;
  const isRepeat = totalOrders >= 3;
  const hasBalance = outstandingBalance > 0;
  const hasRemainingPickups = remainingItems > 0;

  const tags: string[] = [];
  if (isVip) tags.push("vip");
  if (isRepeat) tags.push("repeat");
  if (hasBalance) tags.push("has_balance");
  if (hasRemainingPickups) tags.push("has_pickups");

  return {
    totalOrders,
    completedOrders,
    cancelledOrders,
    activeOrders,
    totalSpending,
    totalPaid,
    outstandingBalance,
    avgOrderValue,
    remainingItems,
    lastOrderDate,
    isVip,
    isRepeat,
    hasBalance,
    hasRemainingPickups,
    tags,
  };
}

customersRouter.post("/backfill", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const allOrders = await db.select().from(orders)
      .where(eq(orders.laundryId, laundryId));

    const unlinkedOrders = allOrders.filter(o => !o.customerId);
    if (unlinkedOrders.length === 0) {
      return res.json({ created: 0, linked: 0, message: "All orders already linked" });
    }

    const existingCustomers = await db.select().from(customers)
      .where(eq(customers.laundryId, laundryId));
    const phoneMap = new Map(existingCustomers.map(c => [c.phone, c]));

    let created = 0;
    let linked = 0;

    const phoneGroups = new Map<string, typeof unlinkedOrders>();
    for (const o of unlinkedOrders) {
      const key = o.phone.trim();
      if (!phoneGroups.has(key)) phoneGroups.set(key, []);
      phoneGroups.get(key)!.push(o);
    }

    for (const [phone, phoneOrders] of phoneGroups) {
      let customer = phoneMap.get(phone);
      if (!customer) {
        const sortedByDate = [...phoneOrders].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        const oldest = sortedByDate[0];
        const newest = sortedByDate[sortedByDate.length - 1];
        const [newCustomer] = await db.insert(customers).values({
          laundryId,
          fullName: oldest.customerName,
          phone: phone,
          address: oldest.address ?? undefined,
          lastActivityAt: new Date(newest.createdAt),
        }).returning();
        customer = newCustomer;
        phoneMap.set(phone, newCustomer);
        created++;
      }

      for (const o of phoneOrders) {
        await db.update(orders).set({ customerId: customer.id }).where(eq(orders.id, o.id));
        linked++;
      }

      const newestDate = phoneOrders.reduce((latest, o) =>
        new Date(o.createdAt) > new Date(latest) ? o.createdAt.toString() : latest,
        new Date(0).toISOString()
      );
      await db.update(customers).set({ lastActivityAt: new Date(newestDate) })
        .where(eq(customers.id, customer.id));
    }

    res.json({ created, linked, message: `Backfill complete: ${created} customers created, ${linked} orders linked` });
  } catch (err) {
    console.error("Backfill error:", err);
    res.status(500).json({ error: "Backfill failed" });
  }
});

customersRouter.get("/", checkPermission("view:customers"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { search, tag, branchId: branchParam, sort, archived } = req.query;

    const effectiveBranchId = req.auth!.branchId ?? (branchParam ? parseInt(branchParam as string) : null);

    const showArchived = archived === "true";
    const baseConditions: any[] = [eq(customers.laundryId, laundryId)];
    if (showArchived) {
      baseConditions.push(isNotNull(customers.deletedAt));
    } else {
      baseConditions.push(isNull(customers.deletedAt));
    }
    if (effectiveBranchId) baseConditions.push(eq(customers.branchId, effectiveBranchId));

    let query = db.select().from(customers).where(and(...baseConditions)).$dynamic();

    if (search) {
      const trimmed = (search as string).trim();
      // support searching by numeric customer ID
      const numericId = /^\d+$/.test(trimmed) ? parseInt(trimmed) : null;
      const searchConditions = [
        ilike(customers.fullName, `%${trimmed}%`),
        ilike(customers.phone, `%${trimmed}%`),
      ];
      if (numericId) searchConditions.push(eq(customers.id, numericId));
      query = query.where(and(...baseConditions, or(...searchConditions)));
    }

    const allCustomers = await query.orderBy(desc(customers.lastActivityAt));

    const ordersConditions: any[] = [eq(orders.laundryId, laundryId)];
    if (effectiveBranchId) ordersConditions.push(eq(orders.branchId, effectiveBranchId));
    const allOrders = await db.select().from(orders).where(and(...ordersConditions));
    const ordersByCustomer = new Map<number, typeof allOrders>();
    for (const o of allOrders) {
      if (o.customerId) {
        if (!ordersByCustomer.has(o.customerId)) ordersByCustomer.set(o.customerId, []);
        ordersByCustomer.get(o.customerId)!.push(o);
      }
    }

    let result = allCustomers.map(c => ({
      ...c,
      customTags: c.tags ? (JSON.parse(c.tags) as string[]) : [] as string[],
      ...computeMetrics(ordersByCustomer.get(c.id) || []),
    }));

    // Tag filter
    if (tag && tag !== "all") {
      const now = Date.now();
      const ninetyDays = 90 * 86400000;
      result = result.filter(c => {
        if (tag === "vip") return c.isVip;
        if (tag === "repeat") return c.isRepeat;
        if (tag === "has_balance") return c.hasBalance;
        if (tag === "has_pickups") return c.hasRemainingPickups;
        if (tag === "inactive") {
          if (!c.lastOrderDate) return true;
          return now - new Date(c.lastOrderDate).getTime() > ninetyDays;
        }
        // custom tag filter
        return c.customTags.some((t: string) => t.toLowerCase() === (tag as string).toLowerCase());
      });
    }

    // Sort
    if (sort && sort !== "newest") {
      result.sort((a, b) => {
        if (sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (sort === "most_orders") return b.totalOrders - a.totalOrders;
        if (sort === "highest_spending") return b.totalSpending - a.totalSpending;
        if (sort === "outstanding_balance") return b.outstandingBalance - a.outstandingBalance;
        if (sort === "last_visit") {
          const at = a.lastOrderDate ? new Date(a.lastOrderDate).getTime() : 0;
          const bt = b.lastOrderDate ? new Date(b.lastOrderDate).getTime() : 0;
          return bt - at;
        }
        return 0;
      });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list customers" });
  }
});

customersRouter.get("/:id", checkPermission("view:customers"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const customerId = parseInt(req.params.id);
    const workerBranchId = req.auth!.branchId;

    const custGetConditions: any[] = [eq(customers.id, customerId), eq(customers.laundryId, laundryId), isNull(customers.deletedAt)];
    if (workerBranchId) custGetConditions.push(eq(customers.branchId, workerBranchId));
    const [customer] = await db.select().from(customers).where(and(...custGetConditions));
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const custOrderConditions: any[] = [eq(orders.customerId, customerId), eq(orders.laundryId, laundryId)];
    if (workerBranchId) custOrderConditions.push(eq(orders.branchId, workerBranchId));
    const customerOrders = await db.select().from(orders)
      .where(and(...custOrderConditions))
      .orderBy(desc(orders.createdAt));

    res.json({
      ...customer,
      ...computeMetrics(customerOrders),
      orders: customerOrders,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get customer" });
  }
});

customersRouter.post("/", checkPermission("create:customers"), requireOperational, requirePlanLimit("customers"), idempotencyMiddleware, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = customerInputSchema.parse(req.body);

    const [existing] = await db.select().from(customers)
      .where(and(eq(customers.laundryId, laundryId), eq(customers.phone, data.phone)));
    if (existing) return res.status(409).json({ error: "A customer with this phone number already exists" });

    // Workers: branchId comes from JWT (live DB value — always current).
    // Owners: use the branchId from the request body if provided.
    const effectiveBranchId = req.auth!.branchId ?? data.branchId ?? undefined;
    const { branchId: _ignored, ...customerData } = data;

    const [customer] = await db.insert(customers).values({
      laundryId,
      branchId: effectiveBranchId,
      ...customerData,
    }).returning();
    trackActivationEvent(laundryId, "customer_created");
    res.status(201).json({ ...customer, ...computeMetrics([]) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to create customer" });
  }
});

customersRouter.patch("/:id", checkPermission("edit:customer-identity"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const customerId = parseInt(req.params.id);
    const workerBranchId = req.auth!.branchId;
    const parsed = customerUpdateSchema.parse(req.body);

    if (parsed.phone) {
      const [conflict] = await db.select().from(customers)
        .where(and(eq(customers.laundryId, laundryId), eq(customers.phone, parsed.phone)));
      if (conflict && conflict.id !== customerId) {
        return res.status(409).json({ error: "Another customer already has this phone number" });
      }
    }

    // Serialize tags array to JSON string for storage
    const { tags: tagsArray, ...rest } = parsed;
    const data: any = { ...rest };
    if (tagsArray !== undefined) {
      data.tags = tagsArray === null ? null : JSON.stringify(tagsArray);
    }

    const custPatchConditions: any[] = [eq(customers.id, customerId), eq(customers.laundryId, laundryId)];
    if (workerBranchId) custPatchConditions.push(eq(customers.branchId, workerBranchId));
    const [customer] = await db.update(customers).set(data)
      .where(and(...custPatchConditions))
      .returning();
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // Return with parsed customTags
    res.json({
      ...customer,
      customTags: customer.tags ? JSON.parse(customer.tags) : [],
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update customer" });
  }
});

customersRouter.get("/:id/receipts", checkPermission("view:customer-balances"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const customerId = parseInt(req.params.id);
    const custReceiptConditions: any[] = [eq(customers.id, customerId), eq(customers.laundryId, laundryId)];
    if (workerBranchId) custReceiptConditions.push(eq(customers.branchId, workerBranchId));
    const [customer] = await db.select({ id: customers.id })
      .from(customers)
      .where(and(...custReceiptConditions));
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const rows = await db
      .select({
        id: paymentRecords.id,
        receiptNumber: paymentRecords.receiptNumber,
        orderId: orders.orderId,
        customerName: orders.customerName,
        phone: orders.phone,
        amount: paymentRecords.amount,
        method: paymentRecords.method,
        remainingBalance: paymentRecords.remainingBalance,
        recordedBy: paymentRecords.recordedBy,
        recordedAt: paymentRecords.recordedAt,
        paymentStatus: orders.paymentStatus,
      })
      .from(paymentRecords)
      .innerJoin(orders, and(eq(paymentRecords.orderId, orders.id), eq(orders.customerId, customerId)))
      .where(eq(paymentRecords.laundryId, laundryId))
      .orderBy(desc(paymentRecords.recordedAt))
      .limit(100);

    res.json({ receipts: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch customer receipts" });
  }
});

customersRouter.get("/:id/statement", checkPermission("view:customer-balances"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const customerId = parseInt(req.params.id);
    const { from, to } = req.query as { from?: string; to?: string };

    // ── Customer lookup ────────────────────────────────────────────────────
    const custStmtConditions: any[] = [eq(customers.id, customerId), eq(customers.laundryId, laundryId)];
    if (workerBranchId) custStmtConditions.push(eq(customers.branchId, workerBranchId));
    const [customer] = await db.select().from(customers).where(and(...custStmtConditions));
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const [laundry] = await db.select().from(laundries).where(eq(laundries.id, laundryId));
    const laundryPaymentDetails = ((laundry?.businessProfile as any)?.paymentDetails) ?? null;

    // ── Period boundaries ──────────────────────────────────────────────────
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);

    // ── Opening balance: ALL activity strictly before fromDate ─────────────
    // This tells us what the customer owed (or was owed) at period start.
    const preOrders = await db.select().from(orders).where(and(
      eq(orders.customerId, customerId),
      eq(orders.laundryId, laundryId),
      lt(orders.createdAt, fromDate),
    ));
    const preOrderIds = preOrders.map((o: any) => o.id);

    const [prePayments, preAdjustments] = await Promise.all([
      preOrderIds.length
        ? db.select().from(paymentRecords).where(and(
            inArray(paymentRecords.orderId, preOrderIds),
            lt(paymentRecords.recordedAt, fromDate),
            isNull(paymentRecords.deletedAt),
          ))
        : Promise.resolve([]),
      preOrderIds.length
        ? db.select().from(priceAdjustments).where(and(
            inArray(priceAdjustments.orderId, preOrderIds),
            lt(priceAdjustments.createdAt, fromDate),
          ))
        : Promise.resolve([]),
    ]);

    // Cancelled orders contribute ₦0 to balance. Adjustments on cancelled
    // orders are also skipped — they have no financial consequence.
    let openingBalance = 0;
    for (const o of preOrders) {
      if (o.status === "cancelled") continue;
      openingBalance += parseFloat(o.price as string || "0");
    }
    for (const adj of preAdjustments) {
      // Skip adjustments on cancelled pre-period orders
      const parentOrder = preOrders.find((o: any) => o.id === adj.orderId);
      if (parentOrder?.status === "cancelled") continue;
      if (adj.type === "extra_charge") openingBalance += parseFloat(adj.amount as string || "0");
      else if (adj.type === "discount") openingBalance -= parseFloat(adj.amount as string || "0");
    }
    for (const p of prePayments) {
      openingBalance -= parseFloat(p.amount as string || "0");
    }

    // ── Period activity ────────────────────────────────────────────────────
    const periodOrders = await db.select().from(orders)
      .where(and(
        eq(orders.customerId, customerId),
        eq(orders.laundryId, laundryId),
        gte(orders.createdAt, fromDate),
        lte(orders.createdAt, toDate),
      ))
      .orderBy(desc(orders.createdAt));

    const orderIds = periodOrders.map((o: any) => o.id);

    const [payments, pickups, adjustments] = await Promise.all([
      orderIds.length
        ? db.select().from(paymentRecords).where(and(
            inArray(paymentRecords.orderId, orderIds),
            gte(paymentRecords.recordedAt, fromDate),
            lte(paymentRecords.recordedAt, toDate),
            isNull(paymentRecords.deletedAt),   // exclude voided/deleted payments
          ))
        : Promise.resolve([]),
      orderIds.length
        ? db.select().from(pickupRecords).where(and(
            inArray(pickupRecords.orderId, orderIds),
            gte(pickupRecords.createdAt, fromDate),
            lte(pickupRecords.createdAt, toDate),
          ))
        : Promise.resolve([]),
      orderIds.length
        ? db.select().from(priceAdjustments).where(and(
            inArray(priceAdjustments.orderId, orderIds),
            gte(priceAdjustments.createdAt, fromDate),
            lte(priceAdjustments.createdAt, toDate),
          ))
        : Promise.resolve([]),
    ]);

    const orderMap = new Map(periodOrders.map((o: any) => [o.id, o]));

    type Entry = {
      date: string;
      type: "order" | "payment" | "discount" | "extra_charge" | "pickup" | "cancelled";
      description: string;
      orderId: string;
      orderDbId: number;
      receiptNumber?: string | null;
      charge: number;
      credit: number;
      balance: number;
      recordedBy?: string | null;
      method?: string | null;
    };

    const rawEntries: Omit<Entry, "balance">[] = [];

    // Orders: charge = BASE PRICE only (not including adjustments).
    // Adjustments appear as separate ledger entries below, preventing double-counting.
    // Cancelled orders are shown as informational entries with charge = 0.
    for (const o of periodOrders) {
      const isCancelled = o.status === "cancelled";
      rawEntries.push({
        date: o.createdAt.toISOString(),
        type: isCancelled ? "cancelled" : "order",
        description: isCancelled
          ? `Order cancelled — ${o.serviceType} (${o.shirts}S / ${o.trousers}T)`
          : `Order created — ${o.serviceType} (${o.shirts}S / ${o.trousers}T)`,
        orderId: o.orderId,
        orderDbId: o.id,
        charge: isCancelled ? 0 : parseFloat(o.price as string || "0"),
        credit: 0,
        recordedBy: null,
        method: null,
      });
    }

    // Payments — voided payments already excluded by isNull(deletedAt) above
    for (const p of payments) {
      const o = orderMap.get(p.orderId);
      rawEntries.push({
        date: p.recordedAt.toISOString(),
        type: "payment",
        description: `Payment received via ${p.method}${p.notes ? " — " + p.notes : ""}`,
        orderId: o?.orderId ?? `#${p.orderId}`,
        orderDbId: p.orderId,
        receiptNumber: p.receiptNumber,
        charge: 0,
        credit: parseFloat(p.amount as string),
        recordedBy: p.recordedBy,
        method: p.method,
      });
    }

    // Price adjustments — skipped for cancelled orders (no financial effect)
    for (const adj of adjustments) {
      const o = orderMap.get(adj.orderId);
      if (o?.status === "cancelled") continue;
      rawEntries.push({
        date: adj.createdAt.toISOString(),
        type: adj.type as "discount" | "extra_charge",
        description: `${adj.type === "discount" ? "Discount" : "Extra charge"} — ${adj.reason}`,
        orderId: o?.orderId ?? `#${adj.orderId}`,
        orderDbId: adj.orderId,
        charge: adj.type === "extra_charge" ? parseFloat(adj.amount as string) : 0,
        credit: adj.type === "discount" ? parseFloat(adj.amount as string) : 0,
        recordedBy: adj.appliedBy,
        method: null,
      });
    }

    // Pickups — informational only, no financial impact on running balance
    for (const pk of pickups) {
      const o = orderMap.get(pk.orderId);
      const items = [
        pk.shirtsPickedUp > 0 ? `${pk.shirtsPickedUp}S` : "",
        pk.trousersPickedUp > 0 ? `${pk.trousersPickedUp}T` : "",
      ].filter(Boolean).join(" / ");
      rawEntries.push({
        date: pk.createdAt.toISOString(),
        type: "pickup",
        description: `Pickup — ${items || "items collected"}${pk.notes ? " (" + pk.notes + ")" : ""}`,
        orderId: o?.orderId ?? `#${pk.orderId}`,
        orderDbId: pk.orderId,
        charge: 0,
        credit: 0,
        recordedBy: pk.recordedBy,
        method: null,
      });
    }

    // Sort chronologically; running balance starts from opening balance
    rawEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = openingBalance;
    const entries: Entry[] = rawEntries.map(e => {
      runningBalance += e.charge - e.credit;
      return { ...e, balance: runningBalance };
    });

    // ── Summary ────────────────────────────────────────────────────────────
    const orderEntries       = rawEntries.filter(e => e.type === "order");
    const paymentEntries     = rawEntries.filter(e => e.type === "payment");
    const discountEntries    = rawEntries.filter(e => e.type === "discount");
    const extraChargeEntries = rawEntries.filter(e => e.type === "extra_charge");
    const cancelledEntries   = rawEntries.filter(e => e.type === "cancelled");

    const totalBaseCharges  = orderEntries.reduce((s, e) => s + e.charge, 0);
    const totalExtraCharges = extraChargeEntries.reduce((s, e) => s + e.charge, 0);
    const totalDiscounts    = discountEntries.reduce((s, e) => s + e.credit, 0);
    const totalPaid         = paymentEntries.reduce((s, e) => s + e.credit, 0);
    // Net charges for the period: base orders + extras − discounts
    const totalCharged      = totalBaseCharges + totalExtraCharges - totalDiscounts;

    res.json({
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.phone,
        address: customer.address,
      },
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      openingBalance,
      paymentDetails: laundryPaymentDetails,
      entries,
      summary: {
        openingBalance,
        totalCharged,
        totalBaseCharges,
        totalExtraCharges,
        totalDiscounts,
        totalPaid,
        closingBalance: runningBalance,
        orderCount: orderEntries.length,
        cancelledOrderCount: cancelledEntries.length,
        paymentCount: paymentEntries.length,
      },
    });
  } catch (err) {
    console.error("Statement error:", err);
    res.status(500).json({ error: "Failed to generate statement" });
  }
});

customersRouter.delete("/:id", checkPermission("delete:customers"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const customerId = parseInt(req.params.id);

    const [existing] = await db.select().from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.laundryId, laundryId), isNull(customers.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Customer not found" });

    const auth = req.auth!;
    await db.update(customers).set({
      deletedAt: new Date(),
      deletedById: auth.type === "owner" ? (auth.ownerId ?? null) : (auth.workerId ?? null),
      deletedByType: auth.type,
      deletedByName: auth.name ?? auth.email ?? "unknown",
    }).where(eq(customers.id, customerId));

    logAction({
      auth,
      laundryId,
      action: "customer_deleted",
      metadata: { customerId, fullName: existing.fullName, phone: existing.phone },
    }).catch(() => {});

    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete customer" });
  }
});

customersRouter.post("/:id/restore", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const customerId = parseInt(req.params.id);

    const [existing] = await db.select().from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.laundryId, laundryId), isNotNull(customers.deletedAt)));
    if (!existing) return res.status(404).json({ error: "Deleted customer not found" });

    const [restored] = await db.update(customers).set({
      deletedAt: null,
      deletedById: null,
      deletedByType: null,
      deletedByName: null,
    }).where(eq(customers.id, customerId)).returning();

    logAction({
      auth: req.auth!,
      laundryId,
      action: "customer_restored",
      metadata: { customerId, fullName: existing.fullName, phone: existing.phone },
    }).catch(() => {});

    res.json(restored);
  } catch {
    res.status(500).json({ error: "Failed to restore customer" });
  }
});
