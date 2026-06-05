import { Router } from "express";
import { db } from "@workspace/db";
import { alerts } from "@workspace/db/schema";
import { eq, and, ne, gte, lte, desc, sql } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { runAlertChecksForLaundry } from "../lib/alert-engine.js";

export const alertsRouter = Router();

function getLimit(raw: unknown, max = 200): number {
  const n = parseInt(raw as string);
  if (!n || n < 1) return 50;
  return Math.min(n, max);
}

function getOffset(raw: unknown): number {
  const n = parseInt(raw as string);
  return !n || n < 0 ? 0 : n;
}

// GET /api/alerts — list with filters
alertsRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const q = req.query as Record<string, string>;
    const limit = getLimit(q.limit);
    const offset = getOffset(q.offset);

    const conditions: ReturnType<typeof eq>[] = [
      eq(alerts.laundryId, laundryId),
    ];
    if (q.status && ["open", "acknowledged", "resolved"].includes(q.status)) {
      conditions.push(eq(alerts.status, q.status as any));
    }
    if (q.severity && ["info", "warning", "critical"].includes(q.severity)) {
      conditions.push(eq(alerts.severity, q.severity as any));
    }
    if (q.category) {
      conditions.push(eq(alerts.category, q.category as any));
    }
    if (q.branchId) {
      conditions.push(eq(alerts.branchId, parseInt(q.branchId)));
    }
    if (q.from) {
      conditions.push(gte(alerts.createdAt, new Date(q.from)));
    }
    if (q.to) {
      conditions.push(lte(alerts.createdAt, new Date(q.to)));
    }

    const where = and(...conditions);

    const [rows, [countRow]] = await Promise.all([
      db
        .select()
        .from(alerts)
        .where(where)
        .orderBy(desc(alerts.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(alerts)
        .where(where),
    ]);

    res.json({ alerts: rows, total: countRow.total });
  } catch (err) {
    console.error("[alerts] list error:", err);
    res.status(500).json({ error: "Failed to load alerts" });
  }
});

// GET /api/alerts/counts — summary counts for dashboard cards
alertsRouter.get("/counts", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;

    const rows = await db
      .select({
        severity: alerts.severity,
        status: alerts.status,
        count: sql<number>`count(*)::int`,
      })
      .from(alerts)
      .where(eq(alerts.laundryId, laundryId))
      .groupBy(alerts.severity, alerts.status);

    const counts = {
      critical: 0,
      warning: 0,
      info: 0,
      unresolved: 0,
      open: 0,
      acknowledged: 0,
      resolved: 0,
    };

    for (const row of rows) {
      const sev = row.severity as keyof typeof counts;
      const st = row.status as keyof typeof counts;
      if (sev in counts) counts[sev] += row.count;
      if (st in counts) counts[st] += row.count;
      if (row.status !== "resolved") counts.unresolved += row.count;
    }

    res.json(counts);
  } catch (err) {
    console.error("[alerts] counts error:", err);
    res.status(500).json({ error: "Failed to load alert counts" });
  }
});

// POST /api/alerts/run-check — manually trigger alert evaluation
alertsRouter.post("/run-check", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const result = await runAlertChecksForLaundry(laundryId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[alerts] run-check error:", err);
    res.status(500).json({ error: "Failed to run alert checks" });
  }
});

// POST /api/alerts/:id/acknowledge
alertsRouter.post("/:id/acknowledge", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const actorName = req.auth!.name ?? req.auth!.email ?? "Owner";

    const [existing] = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.id, id), eq(alerts.laundryId, laundryId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Alert not found" });
    if (existing.status !== "open")
      return res.status(400).json({ error: "Only open alerts can be acknowledged" });

    const [updated] = await db
      .update(alerts)
      .set({ status: "acknowledged", acknowledgedBy: actorName, acknowledgedAt: new Date() })
      .where(eq(alerts.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error("[alerts] acknowledge error:", err);
    res.status(500).json({ error: "Failed to acknowledge alert" });
  }
});

// POST /api/alerts/:id/resolve
alertsRouter.post("/:id/resolve", async (req: AuthRequest, res) => {
  try {
    const laundryId = req.auth!.laundryId;
    const id = parseInt(req.params.id);
    const actorName = req.auth!.name ?? req.auth!.email ?? "Owner";

    const [existing] = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.id, id), eq(alerts.laundryId, laundryId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Alert not found" });
    if (existing.status === "resolved")
      return res.status(400).json({ error: "Alert is already resolved" });

    const [updated] = await db
      .update(alerts)
      .set({ status: "resolved", resolvedBy: actorName, resolvedAt: new Date() })
      .where(eq(alerts.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error("[alerts] resolve error:", err);
    res.status(500).json({ error: "Failed to resolve alert" });
  }
});
