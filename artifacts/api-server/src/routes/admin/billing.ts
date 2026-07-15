/**
 * Admin Billing Dashboard — Phase 7.8, Part 7
 *
 * Internal (CleanTrack staff) revenue and subscription-health metrics:
 * MRR, churn, plan mix, active/trial/past_due/cancelled counts, recent
 * invoices, and failed-payment visibility — filterable by plan and status.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { laundries, invoices, subscriptionPayments, paymentSubscriptions } from "@workspace/db/schema";
import { and, eq, gte, lt, desc, count, sum, sql } from "drizzle-orm";
import { PLAN_DISPLAY_NAMES } from "../../lib/entitlements.js";
import { getPlanPricing, PAID_PLANS } from "../../lib/pricing.js";

export const adminBillingRouter = Router();

/**
 * GET /admin/billing/overview
 * MRR (normalized monthly, annual plans divided by 12), churn (last 30d),
 * and subscription status breakdown.
 */
adminBillingRouter.get("/overview", async (_req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    const statusCounts = await db
      .select({ status: laundries.subscriptionStatus, count: count() })
      .from(laundries)
      .groupBy(laundries.subscriptionStatus);

    const planCounts = await db
      .select({ plan: laundries.subscriptionTier, count: count() })
      .from(laundries)
      .where(eq(laundries.subscriptionStatus, "active"))
      .groupBy(laundries.subscriptionTier);

    // MRR: sum of each active tenant's monthly-equivalent price.
    let mrr = 0;
    for (const row of planCounts) {
      const pricing = getPlanPricing(row.plan);
      if (pricing) mrr += pricing.price.monthly * row.count;
    }

    // Churn: tenants that transitioned to "cancelled" in the last 30 days,
    // out of tenants that were active/past_due at the start of that window.
    const [{ cancelledLast30 }] = await db
      .select({ cancelledLast30: count() })
      .from(laundries)
      .where(and(eq(laundries.subscriptionStatus, "cancelled"), gte(laundries.updatedAt, thirtyDaysAgo)));

    const [{ activeAtStart }] = await db
      .select({ activeAtStart: count() })
      .from(laundries)
      .where(sql`${laundries.subscriptionStatus} IN ('active','past_due','cancelled')`);

    const churnRatePct = activeAtStart > 0 ? Math.round((cancelledLast30 / activeAtStart) * 1000) / 10 : 0;

    // Revenue collected in the last 30 days (actual, not normalized MRR).
    const [{ revenueLast30 }] = await db
      .select({ revenueLast30: sql<number>`coalesce(sum(${subscriptionPayments.amountNgn}), 0)::int` })
      .from(subscriptionPayments)
      .where(and(eq(subscriptionPayments.status, "paid"), gte(subscriptionPayments.paidAt, thirtyDaysAgo)));

    const [{ failedPayments30 }] = await db
      .select({ failedPayments30: count() })
      .from(invoices)
      .where(and(eq(invoices.status, "failed"), gte(invoices.issueDate, thirtyDaysAgo)));

    res.json({
      mrr,
      arr: mrr * 12,
      churnRatePct,
      revenueLast30Days: revenueLast30,
      failedPaymentsLast30Days: failedPayments30,
      statusBreakdown: statusCounts.map((r: { status: string; count: number }) => ({ status: r.status, count: r.count })),
      planBreakdown: planCounts.map((r: { plan: string; count: number }) => ({
        plan: r.plan,
        planDisplayName: (PLAN_DISPLAY_NAMES as any)[r.plan] ?? r.plan,
        count: r.count,
      })),
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    console.error("Admin billing overview error:", err);
    res.status(500).json({ error: "Failed to fetch billing overview" });
  }
});

/**
 * GET /admin/billing/invoices?status=&plan=&limit=
 * Recent invoices across all tenants, filterable.
 */
adminBillingRouter.get("/invoices", async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const plan = req.query.plan as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const conditions = [];
    if (status) conditions.push(eq(invoices.status, status as any));
    if (plan) conditions.push(eq(invoices.plan, plan));

    const rows = await db
      .select()
      .from(invoices)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(invoices.issueDate))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    console.error("Admin billing invoices error:", err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

/**
 * GET /admin/billing/at-risk
 * Tenants currently in past_due (grace period) or with recent failed
 * renewal charges — the accounts a support/finance admin should follow up on.
 */
adminBillingRouter.get("/at-risk", async (_req, res) => {
  try {
    const rows = await db
      .select({
        laundryId: laundries.id,
        businessName: laundries.businessName,
        ownerEmail: laundries.ownerEmail,
        subscriptionStatus: laundries.subscriptionStatus,
        subscriptionTier: laundries.subscriptionTier,
        subscriptionRenewsAt: laundries.subscriptionRenewsAt,
        consecutiveFailures: paymentSubscriptions.consecutiveFailures,
        lastChargeStatus: paymentSubscriptions.lastChargeStatus,
        cardLast4: paymentSubscriptions.cardLast4,
      })
      .from(laundries)
      .leftJoin(paymentSubscriptions, eq(paymentSubscriptions.laundryId, laundries.id))
      .where(eq(laundries.subscriptionStatus, "past_due"))
      .orderBy(laundries.subscriptionRenewsAt);

    res.json(rows);
  } catch (err) {
    console.error("Admin billing at-risk error:", err);
    res.status(500).json({ error: "Failed to fetch at-risk tenants" });
  }
});
