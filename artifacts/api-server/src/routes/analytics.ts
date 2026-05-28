import { Router } from "express";
import { db } from "@workspace/db";
import { orders, batches, workers, customers, pickupRecords } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";

export const analyticsRouter = Router();

function periodToDate(period: string): Date {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === "7d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (period === "30d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d;
  }
  if (period === "90d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 90);
    return d;
  }
  const d = new Date(now);
  d.setDate(d.getDate() - 7);
  return d;
}

function orderTotalDue(o: any) {
  return parseFloat(o.price || "0") + parseFloat(o.extraCharge || "0") - parseFloat(o.discount || "0");
}

analyticsRouter.get("/overview", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const allOrders = await db.select().from(orders).where(eq(orders.laundryId, laundryId));
    const allBatches = await db.select().from(batches).where(eq(batches.laundryId, laundryId));

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const ordersThisWeek = allOrders.filter(o => new Date(o.createdAt) >= startOfWeek).length;
    const ordersLastWeek = allOrders.filter(o => {
      const d = new Date(o.createdAt);
      return d >= startOfLastWeek && d < startOfWeek;
    }).length;

    const weeklyGrowthPercent = ordersLastWeek === 0
      ? (ordersThisWeek > 0 ? 100 : 0)
      : ((ordersThisWeek - ordersLastWeek) / ordersLastWeek) * 100;

    const activeBatches = allBatches.filter(b => b.status === "active").length;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const delayedOrders = allOrders.filter(o =>
      !["completed", "ready"].includes(o.status) && new Date(o.createdAt) < sevenDaysAgo
    ).length;

    res.json({
      totalOrders: allOrders.length,
      totalRevenue: allOrders.reduce((sum, o) => sum + orderTotalDue(o), 0),
      collectedRevenue: allOrders.reduce((sum, o) => sum + parseFloat(o.amountPaid || "0"), 0),
      pendingRevenue: allOrders.reduce((sum, o) => sum + Math.max(0, orderTotalDue(o) - parseFloat(o.amountPaid || "0")), 0),
      ordersThisWeek,
      ordersLastWeek,
      weeklyGrowthPercent: Math.round(weeklyGrowthPercent * 10) / 10,
      ordersThisMonth: allOrders.filter(o => new Date(o.createdAt) >= startOfMonth).length,
      activeBatches,
      delayedOrders,
    });
  } catch {
    res.status(500).json({ error: "Failed to get analytics overview" });
  }
});

analyticsRouter.get("/daily", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const allOrders = await db.select().from(orders).where(eq(orders.laundryId, laundryId));
    const dailyMap: Record<string, { count: number; revenue: number }> = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dailyMap[d.toISOString().slice(0, 10)] = { count: 0, revenue: 0 };
    }
    for (const o of allOrders) {
      const key = new Date(o.createdAt).toISOString().slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].count++;
        dailyMap[key].revenue += orderTotalDue(o);
      }
    }
    res.json(Object.entries(dailyMap).map(([date, data]) => ({ date, ...data })));
  } catch {
    res.status(500).json({ error: "Failed to get daily analytics" });
  }
});

analyticsRouter.get("/full", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const period = (req.query.period as string) || "7d";
    const since = periodToDate(period);
    const prevSince = new Date(since.getTime() - (Date.now() - since.getTime()));

    const allOrders = await db.select().from(orders).where(eq(orders.laundryId, laundryId));
    const periodOrders = allOrders.filter(o => new Date(o.createdAt) >= since);
    const prevOrders = allOrders.filter(o => {
      const d = new Date(o.createdAt);
      return d >= prevSince && d < since;
    });

    const calc = (os: typeof allOrders) => {
      const totalRevenue = os.reduce((s, o) => s + orderTotalDue(o), 0);
      const collectedRevenue = os.reduce((s, o) => s + parseFloat(o.amountPaid || "0"), 0);
      const outstandingBalance = os.reduce((s, o) => s + Math.max(0, orderTotalDue(o) - parseFloat(o.amountPaid || "0")), 0);
      const avgOrderValue = os.length > 0 ? totalRevenue / os.length : 0;
      return { totalRevenue, collectedRevenue, outstandingBalance, avgOrderValue, count: os.length };
    };

    const curr = calc(periodOrders);
    const prev = calc(prevOrders);

    const pctChange = (cur: number, prv: number) =>
      prv === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prv) / prv) * 1000) / 10;

    const activeOrders = allOrders.filter(o => ["pending", "processing", "ready", "partial_pickup"].includes(o.status));

    const statusCounts = {
      pending: allOrders.filter(o => o.status === "pending").length,
      processing: allOrders.filter(o => o.status === "processing").length,
      ready: allOrders.filter(o => o.status === "ready").length,
      partial_pickup: allOrders.filter(o => o.status === "partial_pickup").length,
      completed: allOrders.filter(o => o.status === "completed").length,
    };

    const paymentCounts = {
      unpaid: allOrders.filter(o => o.paymentStatus === "unpaid").length,
      partial: allOrders.filter(o => o.paymentStatus === "partial").length,
      paid: allOrders.filter(o => o.paymentStatus === "paid").length,
    };

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const delayedOrders = allOrders.filter(o =>
      !["completed", "ready"].includes(o.status) && new Date(o.createdAt) < sevenDaysAgo
    );

    const totalRemainingItems = allOrders
      .filter(o => ["ready", "partial_pickup"].includes(o.status))
      .reduce((s, o) => s + Math.max(0, o.shirts - (o.shirtsPickedUp || 0)) + Math.max(0, o.trousers - (o.trousersPickedUp || 0)), 0);

    const days = period === "today" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : 90;
    const trendMap: Record<string, { date: string; revenue: number; collected: number; orders: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      trendMap[key] = { date: key, revenue: 0, collected: 0, orders: 0 };
    }
    for (const o of allOrders) {
      const key = new Date(o.createdAt).toISOString().slice(0, 10);
      if (trendMap[key]) {
        trendMap[key].revenue += orderTotalDue(o);
        trendMap[key].collected += parseFloat(o.amountPaid || "0");
        trendMap[key].orders++;
      }
    }

    const trends = Object.values(trendMap);

    res.json({
      period,
      overview: {
        totalRevenue: curr.totalRevenue,
        collectedRevenue: curr.collectedRevenue,
        outstandingBalance: curr.outstandingBalance,
        avgOrderValue: curr.avgOrderValue,
        totalOrders: curr.count,
        activeOrders: activeOrders.length,
        completedOrders: statusCounts.completed,
        partialPickup: statusCounts.partial_pickup,
        delayedOrders: delayedOrders.length,
        totalRemainingItems,
      },
      growth: {
        revenue: pctChange(curr.totalRevenue, prev.totalRevenue),
        orders: pctChange(curr.count, prev.count),
        collected: pctChange(curr.collectedRevenue, prev.collectedRevenue),
      },
      statusCounts,
      paymentCounts,
      trends,
      alerts: {
        delayedOrders: delayedOrders.slice(0, 5).map(o => ({
          id: o.id,
          orderId: o.orderId,
          customerName: o.customerName,
          status: o.status,
          daysOld: Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 86400000),
        })),
        unpaidCount: paymentCounts.unpaid,
        partialPickupCount: statusCounts.partial_pickup,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get full analytics" });
  }
});

analyticsRouter.get("/customers", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const allCustomers = await db.select().from(customers).where(eq(customers.laundryId, laundryId));
    const allOrders = await db.select().from(orders).where(eq(orders.laundryId, laundryId));

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const ordersByCustomer = new Map<number, typeof allOrders>();
    for (const o of allOrders) {
      if (o.customerId) {
        if (!ordersByCustomer.has(o.customerId)) ordersByCustomer.set(o.customerId, []);
        ordersByCustomer.get(o.customerId)!.push(o);
      }
    }

    const customerMetrics = allCustomers.map(c => {
      const os = ordersByCustomer.get(c.id) || [];
      const totalSpending = os.reduce((s, o) => s + orderTotalDue(o), 0);
      const totalPaid = os.reduce((s, o) => s + parseFloat(o.amountPaid || "0"), 0);
      const outstandingBalance = Math.max(0, totalSpending - totalPaid);
      const lastActivity = new Date(c.lastActivityAt);
      return {
        id: c.id,
        fullName: c.fullName,
        phone: c.phone,
        totalOrders: os.length,
        totalSpending,
        outstandingBalance,
        isVip: totalSpending >= 50000,
        isRepeat: os.length >= 3,
        isInactive: lastActivity < ninetyDaysAgo,
        isNew: new Date(c.createdAt) >= thirtyDaysAgo,
        lastActivityAt: c.lastActivityAt,
      };
    });

    const topSpenders = [...customerMetrics]
      .sort((a, b) => b.totalSpending - a.totalSpending)
      .slice(0, 10);

    const segments = {
      total: allCustomers.length,
      vip: customerMetrics.filter(c => c.isVip).length,
      repeat: customerMetrics.filter(c => c.isRepeat).length,
      inactive: customerMetrics.filter(c => c.isInactive).length,
      newThisMonth: customerMetrics.filter(c => c.isNew).length,
      withBalance: customerMetrics.filter(c => c.outstandingBalance > 0).length,
      totalOutstanding: customerMetrics.reduce((s, c) => s + c.outstandingBalance, 0),
    };

    res.json({ segments, topSpenders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get customer analytics" });
  }
});

analyticsRouter.get("/workers", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const allWorkers = await db.select().from(workers).where(eq(workers.laundryId, laundryId));
    const allOrders = await db.select().from(orders).where(eq(orders.laundryId, laundryId));
    const allPickups = await db.select().from(pickupRecords).where(eq(pickupRecords.laundryId, laundryId));

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const workerStats = allWorkers.map(w => {
      const assigned = allOrders.filter(o => o.assignedWorkerId === w.id);
      const recentAssigned = assigned.filter(o => new Date(o.createdAt) >= thirtyDaysAgo);
      const completed = assigned.filter(o => o.status === "completed").length;
      const active = assigned.filter(o => ["pending", "processing", "ready", "partial_pickup"].includes(o.status)).length;
      const pickupsProcessed = allPickups.filter(p => p.processedBy === w.id).length;
      const recentPickups = allPickups.filter(p => p.processedBy === w.id && new Date(p.createdAt) >= thirtyDaysAgo).length;
      return {
        id: w.id,
        name: w.name,
        role: w.role,
        isActive: w.isActive,
        totalAssigned: assigned.length,
        recentAssigned: recentAssigned.length,
        completed,
        active,
        pickupsProcessed,
        recentPickups,
      };
    });

    const unassignedOrders = allOrders.filter(o => !o.assignedWorkerId && ["pending", "processing"].includes(o.status)).length;

    res.json({ workers: workerStats, unassignedOrders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get worker analytics" });
  }
});
