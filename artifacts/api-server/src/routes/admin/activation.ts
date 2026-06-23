/**
 * Admin Activation Analytics
 *
 * GET /api/admin/activation/funnel   — funnel drop-off at each step
 * GET /api/admin/activation/metrics  — activation rate, time-to-first-order
 * GET /api/admin/activation/health   — last 7 days signups + stuck accounts
 * GET /api/admin/activation/scores   — per-workspace activation scores + stuck stage
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { activationEvents, laundries } from "@workspace/db/schema";
import { eq, desc, gte, and, sql } from "drizzle-orm";
import {
  FUNNEL_STEPS,
  EVENT_SCORES,
  computeScore,
  getActivationState,
  detectStuckStage,
} from "../../lib/activation-tracker.js";

export const adminActivationRouter = Router();

// ── GET /funnel ──────────────────────────────────────────────────────────────

adminActivationRouter.get("/funnel", async (_req, res) => {
  try {
    // Count distinct laundries that fired each event
    const rows = await db
      .select({
        eventName: activationEvents.eventName,
        count: sql<number>`cast(count(distinct ${activationEvents.laundryId}) as int)`,
      })
      .from(activationEvents)
      .groupBy(activationEvents.eventName);

    const countMap: Record<string, number> = {};
    for (const row of rows) countMap[row.eventName] = row.count;

    const total = countMap["workspace_created"] ?? 0;

    const funnel = FUNNEL_STEPS.map((step, idx) => {
      const count = countMap[step] ?? 0;
      const prevCount = idx === 0 ? total : (countMap[FUNNEL_STEPS[idx - 1]] ?? total);
      const dropOff = prevCount > 0 ? Math.round(((prevCount - count) / prevCount) * 100) : 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return { step, count, pct, dropOff };
    });

    res.json({ funnel, total });
  } catch (err) {
    res.status(500).json({ error: "Failed to load funnel data" });
  }
});

// ── GET /metrics ─────────────────────────────────────────────────────────────

adminActivationRouter.get("/metrics", async (_req, res) => {
  try {
    const totalLaundries = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(laundries)
      .then((r) => r[0]?.count ?? 0);

    // Laundries that have created at least one order
    const activatedCount = await db
      .select({ count: sql<number>`cast(count(distinct laundry_id) as int)` })
      .from(activationEvents)
      .where(eq(activationEvents.eventName, "order_created"))
      .then((r) => r[0]?.count ?? 0);

    const activationRate = totalLaundries > 0
      ? Math.round((activatedCount / totalLaundries) * 100)
      : 0;

    // Average hours from workspace_created to order_created
    const timeToFirstOrder = await db.execute(
      sql`
        SELECT ROUND(AVG(
          EXTRACT(EPOCH FROM (o.created_at - w.created_at)) / 3600
        ))::int AS avg_hours
        FROM activation_events w
        JOIN activation_events o ON o.laundry_id = w.laundry_id
          AND o.event_name = 'order_created'
        WHERE w.event_name = 'workspace_created'
      `
    ).then((r: any) => r.rows?.[0]?.avg_hours ?? null);

    // Average hours from workspace_created to order_completed
    const timeToFirstCompleted = await db.execute(
      sql`
        SELECT ROUND(AVG(
          EXTRACT(EPOCH FROM (c.created_at - w.created_at)) / 3600
        ))::int AS avg_hours
        FROM activation_events w
        JOIN activation_events c ON c.laundry_id = w.laundry_id
          AND c.event_name = 'order_completed'
        WHERE w.event_name = 'workspace_created'
      `
    ).then((r: any) => r.rows?.[0]?.avg_hours ?? null);

    // Email engagement
    const emailSent = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(activationEvents)
      .where(eq(activationEvents.eventName, "welcome_email_sent"))
      .then((r) => r[0]?.count ?? 0);

    const emailOpened = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(activationEvents)
      .where(eq(activationEvents.eventName, "welcome_email_opened"))
      .then((r) => r[0]?.count ?? 0);

    const emailClicked = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(activationEvents)
      .where(eq(activationEvents.eventName, "welcome_email_clicked"))
      .then((r) => r[0]?.count ?? 0);

    res.json({
      totalLaundries,
      activatedCount,
      activationRate,
      timeToFirstOrderHours: timeToFirstOrder,
      timeToFirstCompletedHours: timeToFirstCompleted,
      emailEngagement: {
        sent: emailSent,
        opened: emailOpened,
        clicked: emailClicked,
        openRate: emailSent > 0 ? Math.round((emailOpened / emailSent) * 100) : 0,
        clickRate: emailSent > 0 ? Math.round((emailClicked / emailSent) * 100) : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load activation metrics" });
  }
});

// ── GET /health ───────────────────────────────────────────────────────────────

adminActivationRouter.get("/health", async (_req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // New signups in last 7 days
    const recentLaundries = await db
      .select({
        id: laundries.id,
        businessName: laundries.businessName,
        ownerEmail: laundries.ownerEmail,
        createdAt: laundries.createdAt,
        subscriptionStatus: laundries.subscriptionStatus,
      })
      .from(laundries)
      .where(gte(laundries.createdAt, sevenDaysAgo))
      .orderBy(desc(laundries.createdAt));

    if (recentLaundries.length === 0) {
      return res.json({ daily: [], summary: { total: 0, activated: 0, stuckBeforeOrder: 0, stuckBeforeCompletion: 0, nonActivated: 0 } });
    }

    // Get all activation events for these laundries
    const laundryIds = recentLaundries.map((l) => l.id);
    const events = await db
      .select({ laundryId: activationEvents.laundryId, eventName: activationEvents.eventName })
      .from(activationEvents)
      .where(sql`${activationEvents.laundryId} = ANY(${sql.raw(`ARRAY[${laundryIds.join(",")}]::int[]`)}) `);

    const eventsByLaundry: Record<number, string[]> = {};
    for (const e of events) {
      if (!eventsByLaundry[e.laundryId]) eventsByLaundry[e.laundryId] = [];
      eventsByLaundry[e.laundryId].push(e.eventName);
    }

    const rows = recentLaundries.map((l) => {
      const fired = eventsByLaundry[l.id] ?? [];
      const score = computeScore(fired);
      const state = getActivationState(score);
      const stuck = detectStuckStage(fired);
      return { ...l, score, state, stuck, events: fired };
    });

    const summary = {
      total: rows.length,
      activated: rows.filter((r) => r.state === "activated").length,
      onboarding: rows.filter((r) => r.state === "onboarding").length,
      stuckBeforeOrder: rows.filter((r) => r.stuck === "Customer exists but no order created" || r.stuck === "Services exist but no customer created").length,
      stuckBeforeCompletion: rows.filter((r) => r.stuck === "Order created but not yet completed").length,
      nonActivated: rows.filter((r) => r.state === "new").length,
    };

    res.json({ daily: rows, summary });
  } catch (err) {
    res.status(500).json({ error: "Failed to load health report" });
  }
});

// ── GET /scores ───────────────────────────────────────────────────────────────

adminActivationRouter.get("/scores", async (_req, res) => {
  try {
    // Get all laundries with their events
    const allLaundries = await db
      .select({
        id: laundries.id,
        businessName: laundries.businessName,
        ownerEmail: laundries.ownerEmail,
        createdAt: laundries.createdAt,
        subscriptionStatus: laundries.subscriptionStatus,
      })
      .from(laundries)
      .orderBy(desc(laundries.createdAt))
      .limit(100);

    if (allLaundries.length === 0) return res.json([]);

    const ids = allLaundries.map((l) => l.id);
    const events = await db
      .select({ laundryId: activationEvents.laundryId, eventName: activationEvents.eventName })
      .from(activationEvents)
      .where(sql`${activationEvents.laundryId} = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)}) `);

    const eventsByLaundry: Record<number, string[]> = {};
    for (const e of events) {
      if (!eventsByLaundry[e.laundryId]) eventsByLaundry[e.laundryId] = [];
      eventsByLaundry[e.laundryId].push(e.eventName);
    }

    const result = allLaundries.map((l) => {
      const fired = eventsByLaundry[l.id] ?? [];
      const score = computeScore(fired);
      const state = getActivationState(score);
      const stuck = detectStuckStage(fired);
      return { ...l, score, state, stuck };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to load activation scores" });
  }
});
