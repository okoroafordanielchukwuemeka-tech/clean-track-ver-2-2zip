import { Router } from "express";
import { db } from "@workspace/db";
import { customers, orders } from "@workspace/db/schema";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";

export const customersRouter = Router();

const customerInputSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  address: z.string().optional(),
  notes: z.string().optional(),
});

const customerUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function computeMetrics(customerOrders: any[]) {
  const totalOrders = customerOrders.length;
  const completedOrders = customerOrders.filter(o => o.status === "completed").length;
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

customersRouter.post("/backfill", async (req: AuthRequest, res) => {
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

customersRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const { search, tag } = req.query;

    let query = db.select().from(customers).where(eq(customers.laundryId, laundryId)).$dynamic();

    if (search) {
      query = query.where(and(
        eq(customers.laundryId, laundryId),
        or(
          ilike(customers.fullName, `%${search}%`),
          ilike(customers.phone, `%${search}%`)
        )
      ));
    }

    const allCustomers = await query.orderBy(desc(customers.lastActivityAt));

    const allOrders = await db.select().from(orders).where(eq(orders.laundryId, laundryId));
    const ordersByCustomer = new Map<number, typeof allOrders>();
    for (const o of allOrders) {
      if (o.customerId) {
        if (!ordersByCustomer.has(o.customerId)) ordersByCustomer.set(o.customerId, []);
        ordersByCustomer.get(o.customerId)!.push(o);
      }
    }

    let result = allCustomers.map(c => ({
      ...c,
      ...computeMetrics(ordersByCustomer.get(c.id) || []),
    }));

    if (tag && tag !== "all") {
      result = result.filter(c => {
        if (tag === "vip") return c.isVip;
        if (tag === "repeat") return c.isRepeat;
        if (tag === "has_balance") return c.hasBalance;
        if (tag === "has_pickups") return c.hasRemainingPickups;
        return true;
      });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list customers" });
  }
});

customersRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const customerId = parseInt(req.params.id);

    const [customer] = await db.select().from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.laundryId, laundryId)));
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const customerOrders = await db.select().from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.laundryId, laundryId)))
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

customersRouter.post("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const data = customerInputSchema.parse(req.body);

    const [existing] = await db.select().from(customers)
      .where(and(eq(customers.laundryId, laundryId), eq(customers.phone, data.phone)));
    if (existing) return res.status(409).json({ error: "A customer with this phone number already exists" });

    const [customer] = await db.insert(customers).values({
      laundryId,
      ...data,
    }).returning();
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
    const data = customerUpdateSchema.parse(req.body);

    if (data.phone) {
      const [conflict] = await db.select().from(customers)
        .where(and(eq(customers.laundryId, laundryId), eq(customers.phone, data.phone)));
      if (conflict && conflict.id !== customerId) {
        return res.status(409).json({ error: "Another customer already has this phone number" });
      }
    }

    const [customer] = await db.update(customers).set(data)
      .where(and(eq(customers.id, customerId), eq(customers.laundryId, laundryId)))
      .returning();
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json(customer);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update customer" });
  }
});

customersRouter.delete("/:id", checkPermission("delete:customers"), async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const customerId = parseInt(req.params.id);
    const [deleted] = await db.delete(customers)
      .where(and(eq(customers.id, customerId), eq(customers.laundryId, laundryId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Customer not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete customer" });
  }
});
