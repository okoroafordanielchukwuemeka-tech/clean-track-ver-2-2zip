import { Router } from "express";
import { db } from "@workspace/db";
import { orders, batches } from "@workspace/db/schema";
import { sql, gte, and } from "drizzle-orm";

export const analyticsRouter = Router();

analyticsRouter.get("/overview", async (_req, res) => {
  try {
    const allOrders = await db.select().from(orders);
    const allBatches = await db.select().from(batches);

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
      ? 100
      : ((ordersThisWeek - ordersLastWeek) / ordersLastWeek) * 100;

    const activeBatches = allBatches.filter(b => b.status === "active").length;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const delayedOrders = allOrders.filter(o =>
      o.status !== "ready" && new Date(o.createdAt) < sevenDaysAgo
    ).length;

    const overview = {
      totalOrders: allOrders.length,
      totalRevenue: allOrders.reduce((sum, o) => sum + parseFloat(o.price || "0"), 0),
      collectedRevenue: allOrders.reduce((sum, o) => sum + parseFloat(o.amountPaid || "0"), 0),
      pendingRevenue: allOrders.reduce((sum, o) => {
        const total = parseFloat(o.price || "0");
        const paid = parseFloat(o.amountPaid || "0");
        return sum + Math.max(0, total - paid);
      }, 0),
      ordersThisWeek,
      ordersLastWeek,
      weeklyGrowthPercent: Math.round(weeklyGrowthPercent * 10) / 10,
      ordersThisMonth: allOrders.filter(o => new Date(o.createdAt) >= startOfMonth).length,
      activeBatches,
      delayedOrders,
    };

    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: "Failed to get analytics overview" });
  }
});

analyticsRouter.get("/daily", async (_req, res) => {
  try {
    const allOrders = await db.select().from(orders);
    const dailyMap: Record<string, { count: number; revenue: number }> = {};

    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { count: 0, revenue: 0 };
    }

    for (const order of allOrders) {
      const key = new Date(order.createdAt).toISOString().slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].count++;
        dailyMap[key].revenue += parseFloat(order.price || "0");
      }
    }

    const result = Object.entries(dailyMap).map(([date, data]) => ({
      date,
      count: data.count,
      revenue: data.revenue,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to get daily analytics" });
  }
});
