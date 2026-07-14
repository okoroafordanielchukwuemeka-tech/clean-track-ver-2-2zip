import { Router } from "express";
import { db } from "@workspace/db";
import { pickupRecords, orders, orderItems, customers, laundries, branches, priceAdjustments, paymentRecords, workers } from "@workspace/db/schema";
import { idempotencyMiddleware } from "../lib/idempotency.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { logAction, actorName } from "../lib/audit.js";
import { emitEvent } from "../lib/events.js";
import { fireAutomation } from "../lib/automation-service.js";
import { computeOrderPricing } from "../lib/order-financials.js";

export const pickupsRouter = Router({ mergeParams: true });

const pickupInputSchema = z.object({
  items: z.array(z.object({
    orderItemId: z.number().int(),
    quantity: z.number().int().min(1),
  })).optional(),
  shirtsPickedUp: z.number().int().min(0).optional().default(0),
  trousersPickedUp: z.number().int().min(0).optional().default(0),
  notes: z.string().optional(),
});

pickupsRouter.get("/", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const orderId = parseInt(req.params.orderId);
    const workerBranchId = req.auth!.branchId;
    const pickupGetConditions: any[] = [eq(orders.id, orderId), eq(orders.laundryId, laundryId)];
    if (workerBranchId) pickupGetConditions.push(eq(orders.branchId, workerBranchId));

    const [order] = await db.select().from(orders).where(and(...pickupGetConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const records = await db.select().from(pickupRecords)
      .where(eq(pickupRecords.orderId, orderId))
      .orderBy(desc(pickupRecords.createdAt));

    res.json(records);
  } catch {
    res.status(500).json({ error: "Failed to list pickups" });
  }
});

// Pickup Receipt — printable slip confirming a single pickup event.
// Reuses computeOrderPricing() so the outstanding balance shown here always
// matches Order/Payment Receipts and the Customer Statement.
pickupsRouter.get("/:pickupId/receipt", checkPermission("view:orders"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const workerBranchId = req.auth!.branchId;
    const orderId = parseInt(req.params.orderId);
    const pickupId = parseInt(req.params.pickupId);

    const orderConditions: any[] = [eq(orders.id, orderId), eq(orders.laundryId, laundryId)];
    if (workerBranchId) orderConditions.push(eq(orders.branchId, workerBranchId));
    const [order] = await db.select().from(orders).where(and(...orderConditions));
    if (!order) return res.status(404).json({ error: "Order not found" });

    const [pickup] = await db.select().from(pickupRecords)
      .where(and(eq(pickupRecords.id, pickupId), eq(pickupRecords.orderId, orderId)));
    if (!pickup) return res.status(404).json({ error: "Pickup record not found" });

    const [laundry] = await db.select().from(laundries).where(eq(laundries.id, laundryId));
    const [customer] = order.customerId
      ? await db.select().from(customers).where(eq(customers.id, order.customerId))
      : [null];

    const [items, allPayments, orderBranch, processedByWorker] = await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
      db.select().from(paymentRecords).where(eq(paymentRecords.orderId, order.id)),
      order.branchId
        ? db.select().from(branches).where(eq(branches.id, order.branchId)).then(r => r[0] ?? null)
        : Promise.resolve(null),
      pickup.processedBy
        ? db.select({ name: workers.name }).from(workers).where(eq(workers.id, pickup.processedBy)).then(r => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    const amountPaid = allPayments.reduce((s, p) => s + parseFloat(p.amount || "0"), 0);
    const { basePrice, extraCharge, discount, totalDue, balance, isCancelled } = computeOrderPricing({ ...order, amountPaid: String(amountPaid) });

    const itemsCollected = pickup.itemPickups && pickup.itemPickups.length > 0
      ? pickup.itemPickups.map(ip => ({ name: ip.name, quantity: ip.quantity }))
      : [
          ...(pickup.shirtsPickedUp > 0 ? [{ name: "Shirts", quantity: pickup.shirtsPickedUp }] : []),
          ...(pickup.trousersPickedUp > 0 ? [{ name: "Trousers", quantity: pickup.trousersPickedUp }] : []),
        ];

    const itemsRemaining = items.length > 0
      ? items
          .map(oi => ({ name: oi.name, quantity: Math.max(0, oi.quantity - oi.quantityPickedUp) }))
          .filter(oi => oi.quantity > 0)
      : [
          ...(Math.max(0, order.shirts - order.shirtsPickedUp) > 0 ? [{ name: "Shirts", quantity: Math.max(0, order.shirts - order.shirtsPickedUp) }] : []),
          ...(Math.max(0, order.trousers - order.trousersPickedUp) > 0 ? [{ name: "Trousers", quantity: Math.max(0, order.trousers - order.trousersPickedUp) }] : []),
        ];

    const businessProfile = (laundry?.businessProfile ?? {}) as Record<string, string>;
    const brandingSettings = (laundry?.brandingSettings ?? {}) as Record<string, string>;

    res.json({
      pickup: {
        id: pickup.id,
        pickupNumber: `PU-${String(pickup.id).padStart(6, "0")}`,
        createdAt: pickup.createdAt,
        notes: pickup.notes,
        recordedBy: processedByWorker?.name ?? pickup.recordedBy ?? null,
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
        paymentDetails: (businessProfile as any).paymentDetails ?? null,
      },
      branch: orderBranch ? { id: orderBranch.id, name: orderBranch.name, address: orderBranch.address ?? "" } : null,
      customer: {
        fullName: order.customerName,
        phone: order.phone,
        address: order.address ?? customer?.address ?? "",
      },
      order: {
        id: order.id,
        orderId: order.orderId,
        status: order.status,
        paymentStatus: order.paymentStatus,
      },
      itemsCollected,
      itemsRemaining,
      pricing: { basePrice, extraCharge, discount, totalDue, amountPaid, balance, isCancelled },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get pickup receipt" });
  }
});

pickupsRouter.post("/", checkPermission("record:pickups"), idempotencyMiddleware, async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const orderId = parseInt(req.params.orderId);
    const workerId = req.auth!.type === "worker" ? req.auth!.workerId : undefined;
    const workerBranchId = req.auth!.branchId;

    const data = pickupInputSchema.parse(req.body);

    /**
     * The entire pickup flow runs inside a single transaction with a row-level
     * lock (SELECT … FOR UPDATE) on the order row.
     *
     * Without this lock, two concurrent partial-pickup requests can both read
     * the same item quantities, both validate that sufficient stock remains,
     * and both update the quantities — resulting in over-pickup (items recorded
     * as picked up more than once) and an incorrect final order status.
     *
     * The FOR UPDATE lock serialises all concurrent pickup writers for the same
     * order, guaranteeing that quantity validation and quantity updates are
     * always based on the true current state.
     */
    const txResult = await db.transaction(async (tx) => {
      const branchClause = workerBranchId
        ? sql` AND branch_id = ${workerBranchId}`
        : sql``;

      const lockResult = await tx.execute(
        sql`SELECT id, laundry_id, order_id, customer_id, customer_name, status, price,
                   extra_charge, discount, amount_paid, shirts, trousers,
                   shirts_picked_up, trousers_picked_up
            FROM orders
            WHERE id = ${orderId} AND laundry_id = ${laundryId}${branchClause}
            FOR UPDATE`
      );
      const raw = (lockResult as any).rows?.[0];
      if (!raw) return { notFound: true } as const;

      // Re-map snake_case raw row to camelCase for the logic below
      const order = {
        id: raw.id as number,
        laundryId: raw.laundry_id as number,
        orderId: raw.order_id as string,
        customerId: raw.customer_id as number | null,
        customerName: raw.customer_name as string,
        status: raw.status as string,
        price: raw.price as string,
        extraCharge: raw.extra_charge as string,
        discount: raw.discount as string,
        amountPaid: raw.amount_paid as string,
        shirts: raw.shirts as number,
        trousers: raw.trousers as number,
        shirtsPickedUp: raw.shirts_picked_up as number,
        trousersPickedUp: raw.trousers_picked_up as number,
      };

      if (order.status !== "ready" && order.status !== "partial_pickup") {
        return { badStatus: true } as const;
      }

      const { totalDue, amountPaid } = computeOrderPricing(order);
      const fullyPaid = totalDue <= 0 || amountPaid >= totalDue;

      // Read order items inside the transaction (consistent with the locked order row)
      const allOrderItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

      let allPickedUp = false;
      let newShirtsPickedUp = order.shirtsPickedUp;
      let newTrousersPickedUp = order.trousersPickedUp;
      let remainingShirts = Math.max(0, order.shirts - order.shirtsPickedUp);
      let remainingTrousers = Math.max(0, order.trousers - order.trousersPickedUp);
      let itemPickupsJson: { orderItemId: number; quantity: number; name: string }[] | null = null;
      let responseItems: { id: number; name: string; quantity: number; quantityPickedUp: number; remaining: number }[] | null = null;

      if (allOrderItems.length > 0) {
        if (!data.items || data.items.length === 0) {
          return { itemTrackingRequired: true } as const;
        }

        // Validate all quantities before making any changes
        for (const itemReq of data.items) {
          const oi = allOrderItems.find(i => i.id === itemReq.orderItemId);
          if (!oi) {
            return { itemNotFound: itemReq.orderItemId } as const;
          }
          const remaining = oi.quantity - oi.quantityPickedUp;
          if (itemReq.quantity > remaining) {
            return { overPickup: { name: oi.name, remaining } } as const;
          }
        }

        // All validations passed — apply updates within the transaction
        const updatedPickedUp = new Map(allOrderItems.map(oi => [oi.id, oi.quantityPickedUp]));
        for (const itemReq of data.items) {
          const oi = allOrderItems.find(i => i.id === itemReq.orderItemId)!;
          const newQty = oi.quantityPickedUp + itemReq.quantity;
          await tx.update(orderItems).set({ quantityPickedUp: newQty }).where(eq(orderItems.id, oi.id));
          updatedPickedUp.set(oi.id, newQty);
        }

        allPickedUp = allOrderItems.every(oi => (updatedPickedUp.get(oi.id) ?? 0) >= oi.quantity);

        itemPickupsJson = data.items.map(req => {
          const oi = allOrderItems.find(i => i.id === req.orderItemId)!;
          return { orderItemId: req.orderItemId, quantity: req.quantity, name: oi.name };
        });

        responseItems = allOrderItems.map(oi => {
          const newPickedUp = updatedPickedUp.get(oi.id) ?? 0;
          return { id: oi.id, name: oi.name, quantity: oi.quantity, quantityPickedUp: newPickedUp, remaining: Math.max(0, oi.quantity - newPickedUp) };
        });
      } else {
        if ((data.shirtsPickedUp ?? 0) === 0 && (data.trousersPickedUp ?? 0) === 0) {
          return { noItems: true } as const;
        }

        const requestedShirts = data.shirtsPickedUp ?? 0;
        const requestedTrousers = data.trousersPickedUp ?? 0;
        const availableShirts = order.shirts - order.shirtsPickedUp;
        const availableTrousers = order.trousers - order.trousersPickedUp;

        if (requestedShirts > availableShirts) {
          return { overPickup: { name: "shirts", remaining: availableShirts } } as const;
        }
        if (requestedTrousers > availableTrousers) {
          return { overPickup: { name: "trousers", remaining: availableTrousers } } as const;
        }

        newShirtsPickedUp = order.shirtsPickedUp + requestedShirts;
        newTrousersPickedUp = order.trousersPickedUp + requestedTrousers;
        remainingShirts = Math.max(0, order.shirts - newShirtsPickedUp);
        remainingTrousers = Math.max(0, order.trousers - newTrousersPickedUp);
        allPickedUp = remainingShirts <= 0 && remainingTrousers <= 0;
      }

      const newStatus = allPickedUp && fullyPaid ? "completed" : "partial_pickup";

      const [pickup] = await tx.insert(pickupRecords).values({
        laundryId,
        orderId,
        shirtsPickedUp: data.shirtsPickedUp ?? 0,
        trousersPickedUp: data.trousersPickedUp ?? 0,
        itemPickups: itemPickupsJson,
        notes: data.notes,
        processedBy: workerId,
        recordedBy: actorName(req.auth!),
      }).returning();

      await tx.update(orders).set({
        shirtsPickedUp: newShirtsPickedUp,
        trousersPickedUp: newTrousersPickedUp,
        status: newStatus,
        updatedAt: new Date(),
      }).where(eq(orders.id, orderId));

      return {
        pickup,
        order: {
          status: newStatus,
          shirtsPickedUp: newShirtsPickedUp,
          trousersPickedUp: newTrousersPickedUp,
          remainingShirts,
          remainingTrousers,
          allPickedUp,
          fullyPaid,
          items: responseItems,
        },
        meta: {
          allPickedUp,
          fullyPaid,
          itemPickupsJson,
          orderRef: order.orderId,
          customerId: order.customerId,
          customerName: order.customerName,
          remainingShirts,
          remainingTrousers,
          responseItems,
          newStatus,
          totalDue,
          amountPaid,
        },
      };
    });

    // Handle validation error signals returned from inside the transaction
    if ("notFound" in txResult) return res.status(404).json({ error: "Order not found" });
    if ("badStatus" in txResult) return res.status(400).json({ error: "Order must be ready or partially picked up" });
    if ("itemTrackingRequired" in txResult) return res.status(400).json({ error: "This order uses item-based tracking. Provide items[] to record pickup." });
    if ("itemNotFound" in txResult) return res.status(400).json({ error: `Order item ${txResult.itemNotFound} not found on this order` });
    if ("overPickup" in txResult) return res.status(400).json({ error: `Only ${txResult.overPickup.remaining} of "${txResult.overPickup.name}" remaining to pick up` });
    if ("noItems" in txResult) return res.status(400).json({ error: "At least one item must be picked up" });

    const { pickup, order: orderResult, meta } = txResult;

    // Audit log (fire-and-forget, outside the transaction)
    logAction({
      auth: req.auth!,
      laundryId,
      action: meta.allPickedUp ? "pickup_completed" : "pickup_partial",
      orderId,
      metadata: {
        itemPickups: meta.itemPickupsJson,
        shirtsPickedUp: data.shirtsPickedUp ?? 0,
        trousersPickedUp: data.trousersPickedUp ?? 0,
        allPickedUp: meta.allPickedUp,
        orderId: meta.orderRef,
      },
    }).catch(() => {});

    // Events (fire-and-forget, outside the transaction)
    if (meta.newStatus === "completed") {
      emitEvent({
        laundryId,
        eventType: "pickup_completed",
        title: "Order Completed",
        message: `Order #${meta.orderRef} for ${meta.customerName} — all items picked up${meta.fullyPaid ? " and fully paid" : ""}.`,
        severity: "success",
        relatedOrderId: orderId,
      }).catch(() => {});
    } else {
      const itemsMsg = meta.responseItems
        ? `${meta.responseItems.reduce((s, i) => s + i.remaining, 0)} item(s) still remaining`
        : `${meta.remainingShirts}S / ${meta.remainingTrousers}T remaining`;
      emitEvent({
        laundryId,
        eventType: "partial_pickup",
        title: "Partial Pickup Recorded",
        message: `Order #${meta.orderRef} (${meta.customerName}): ${itemsMsg}.${!meta.fullyPaid ? ` Balance: ₦${Math.max(0, meta.totalDue - meta.amountPaid).toLocaleString()}.` : ""}`,
        severity: "info",
        relatedOrderId: orderId,
      }).catch(() => {});
    }

    // ORDER_DELIVERED automation — fires when all items are picked up (regardless of payment)
    if (meta.allPickedUp) {
      (async () => {
        try {
          let customerPhone: string | null = null;
          if (meta.customerId) {
            const [cust] = await db
              .select({ phone: customers.phone })
              .from(customers)
              .where(eq(customers.id, meta.customerId));
            customerPhone = cust?.phone ?? null;
          }
          await fireAutomation({
            laundryId,
            triggerEvent: "ORDER_DELIVERED",
            customerName: meta.customerName,
            customerPhone,
            orderId: meta.orderRef,
          });
        } catch { /* non-fatal */ }
      })();
    }

    res.status(201).json({ pickup, order: orderResult });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to record pickup" });
  }
});
