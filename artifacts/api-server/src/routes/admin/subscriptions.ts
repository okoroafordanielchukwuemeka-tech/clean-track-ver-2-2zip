import { Router } from "express";
import { db } from "@workspace/db";
import { laundries, subscriptionLogs } from "@workspace/db/schema";
import { eq, and, lt, gte, desc, ne } from "drizzle-orm";
import { z } from "zod";
import type { SubscriptionStatus } from "@workspace/db/schema";
import { AdminRequest } from "../../middleware/admin-auth.js";
import { getPlanFeatures, getPlanLimits, PLAN_DISPLAY_NAMES, getEntitlementReport } from "../../lib/entitlements.js";

export const adminSubscriptionsRouter = Router();

const VALID_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trial: ["active", "cancelled"],
  active: ["past_due", "cancelled"],
  past_due: ["active", "suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: ["active"],
};

const updateSchema = z.object({
  laundryId: z.number().int().positive(),
  status: z.enum(["trial", "active", "past_due", "suspended", "cancelled"]).optional(),
  plan: z.enum(["free", "starter", "pro", "business"]).optional(),
  trialDurationDays: z.number().int().positive().optional(),
  subscriptionRenewsAt: z.string().datetime().optional(),
  reason: z.string().optional(),
});

adminSubscriptionsRouter.get("/trial-candidates", async (req: AdminRequest, res) => {
  try {
    const now = new Date();
    const in14Days = new Date(now.getTime() + 14 * 86_400_000);

    const trialTenants = await db
      .select({
        id: laundries.id,
        businessName: laundries.businessName,
        ownerEmail: laundries.ownerEmail,
        subscriptionTier: laundries.subscriptionTier,
        subscriptionStatus: laundries.subscriptionStatus,
        trialStartedAt: laundries.trialStartedAt,
        trialEndsAt: laundries.trialEndsAt,
        trialDurationDays: laundries.trialDurationDays,
        convertedAt: laundries.convertedAt,
        createdAt: laundries.createdAt,
      })
      .from(laundries)
      .where(eq(laundries.subscriptionStatus, "trial"))
      .orderBy(laundries.trialEndsAt);

    const enriched = trialTenants.map((t) => {
      let trialDaysRemaining: number | null = null;
      let urgency: "critical" | "warning" | "info" | "expired" = "info";

      if (t.trialEndsAt) {
        const msLeft = new Date(t.trialEndsAt).getTime() - now.getTime();
        trialDaysRemaining = Math.ceil(msLeft / 86_400_000);
        if (trialDaysRemaining <= 0) urgency = "expired";
        else if (trialDaysRemaining <= 1) urgency = "critical";
        else if (trialDaysRemaining <= 3) urgency = "warning";
        else urgency = "info";
      }

      return { ...t, trialDaysRemaining, urgency };
    });

    const summary = {
      total: enriched.length,
      expired: enriched.filter((t) => t.urgency === "expired").length,
      critical: enriched.filter((t) => t.urgency === "critical").length,
      warning: enriched.filter((t) => t.urgency === "warning").length,
      healthy: enriched.filter((t) => t.urgency === "info").length,
    };

    const allTenants = await db
      .select({
        id: laundries.id,
        businessName: laundries.businessName,
        ownerEmail: laundries.ownerEmail,
        subscriptionTier: laundries.subscriptionTier,
        subscriptionStatus: laundries.subscriptionStatus,
        convertedAt: laundries.convertedAt,
        subscriptionRenewsAt: laundries.subscriptionRenewsAt,
        createdAt: laundries.createdAt,
      })
      .from(laundries)
      .orderBy(laundries.createdAt);

    const statusSummary: Record<string, number> = {
      trial: 0, active: 0, past_due: 0, suspended: 0, cancelled: 0,
    };
    for (const t of allTenants) {
      const s = t.subscriptionStatus ?? "trial";
      if (s in statusSummary) statusSummary[s]++;
    }

    res.json({ trialCandidates: enriched, summary: statusSummary, allTenants });
  } catch (err) {
    console.error("Admin trial-candidates error:", err);
    res.status(500).json({ error: "Failed to fetch trial candidates" });
  }
});

adminSubscriptionsRouter.get("/state-transitions", (_req, res) => {
  const transitions = Object.entries(VALID_TRANSITIONS).map(([from, tos]) => ({
    from,
    allowedTo: tos,
  }));

  res.json({
    transitions,
    states: {
      trial: "Full access per trial limits. Alerts generated at 7d, 3d, 1d, and expiry.",
      active: "Full access per subscribed plan.",
      past_due: "Access allowed with warning banners. Billing alerts generated.",
      suspended:
        "Login allowed. View-only access. Cannot create orders, workers, branches, or send messages.",
      cancelled:
        "Login allowed. Historical data accessible. No operational actions.",
    },
    entitlements: getEntitlementReport(),
  });
});

adminSubscriptionsRouter.post("/update", async (req: AdminRequest, res) => {
  try {
    const data = updateSchema.parse(req.body);
    const adminName = req.admin?.name ?? "admin";

    const [current] = await db
      .select({
        id: laundries.id,
        subscriptionStatus: laundries.subscriptionStatus,
        subscriptionTier: laundries.subscriptionTier,
        trialStartedAt: laundries.trialStartedAt,
        trialDurationDays: laundries.trialDurationDays,
      })
      .from(laundries)
      .where(eq(laundries.id, data.laundryId));

    if (!current) return res.status(404).json({ error: "Tenant not found" });

    if (data.status && data.status !== current.subscriptionStatus) {
      const allowed = VALID_TRANSITIONS[current.subscriptionStatus as SubscriptionStatus] ?? [];
      if (!allowed.includes(data.status as SubscriptionStatus)) {
        return res.status(400).json({
          error: "Invalid state transition",
          from: current.subscriptionStatus,
          to: data.status,
          allowed,
        });
      }
    }

    const updates: Record<string, any> = { updatedAt: new Date() };

    if (data.status) {
      updates.subscriptionStatus = data.status;
      if (data.status === "active" && current.subscriptionStatus !== "active") {
        updates.convertedAt = updates.convertedAt ?? new Date();
      }
    }
    if (data.plan) updates.subscriptionTier = data.plan;
    if (data.trialDurationDays !== undefined) {
      updates.trialDurationDays = data.trialDurationDays;
      if (current.trialStartedAt) {
        updates.trialEndsAt = new Date(
          new Date(current.trialStartedAt).getTime() +
            data.trialDurationDays * 86_400_000
        );
      }
    }
    if (data.subscriptionRenewsAt) {
      updates.subscriptionRenewsAt = new Date(data.subscriptionRenewsAt);
    }

    const [updated] = await db
      .update(laundries)
      .set(updates)
      .where(eq(laundries.id, data.laundryId))
      .returning();

    await db.insert(subscriptionLogs).values({
      laundryId: data.laundryId,
      fromStatus: current.subscriptionStatus as SubscriptionStatus,
      toStatus: (data.status ?? current.subscriptionStatus) as SubscriptionStatus,
      fromPlan: current.subscriptionTier,
      toPlan: data.plan ?? current.subscriptionTier,
      reason: data.reason ?? null,
      changedBy: `admin:${adminName}`,
      metadata: { adminId: req.admin?.adminId },
    });

    const { passwordHash: _ph, ...safe } = updated;
    res.json({ tenant: safe, message: "Subscription updated successfully" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    console.error("Admin subscription update error:", err);
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

adminSubscriptionsRouter.post("/state-transitions", async (req: AdminRequest, res) => {
  try {
    const schema = z.object({
      laundryId: z.coerce.number().int().positive(),
      newStatus: z.enum(["trial", "active", "past_due", "suspended", "cancelled"]),
      plan: z.enum(["free", "starter", "pro", "business"]).optional(),
      reason: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const adminName = req.admin?.name ?? "admin";

    const [current] = await db
      .select({
        id: laundries.id,
        subscriptionStatus: laundries.subscriptionStatus,
        subscriptionTier: laundries.subscriptionTier,
      })
      .from(laundries)
      .where(eq(laundries.id, data.laundryId));

    if (!current) return res.status(404).json({ error: "Tenant not found" });

    const allowed = VALID_TRANSITIONS[current.subscriptionStatus as SubscriptionStatus] ?? [];
    if (!allowed.includes(data.newStatus as SubscriptionStatus)) {
      return res.status(400).json({
        error: "Invalid state transition",
        from: current.subscriptionStatus,
        to: data.newStatus,
        allowed,
      });
    }

    const updates: Record<string, any> = {
      subscriptionStatus: data.newStatus,
      updatedAt: new Date(),
    };
    if (data.newStatus === "active" && current.subscriptionStatus !== "active") {
      updates.convertedAt = new Date();
    }
    if (data.plan) updates.subscriptionTier = data.plan;

    const [updated] = await db
      .update(laundries)
      .set(updates)
      .where(eq(laundries.id, data.laundryId))
      .returning();

    await db.insert(subscriptionLogs).values({
      laundryId: data.laundryId,
      fromStatus: current.subscriptionStatus as SubscriptionStatus,
      toStatus: data.newStatus as SubscriptionStatus,
      fromPlan: current.subscriptionTier,
      toPlan: data.plan ?? current.subscriptionTier,
      reason: data.reason ?? null,
      changedBy: `admin:${adminName}`,
      metadata: { adminId: req.admin?.adminId },
    });

    const { passwordHash: _ph, ...safe } = updated;
    res.json({ tenant: safe, message: "State transition applied" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    console.error("Admin state-transition error:", err);
    res.status(500).json({ error: "Failed to apply state transition" });
  }
});

adminSubscriptionsRouter.get("/logs/:laundryId", async (req, res) => {
  try {
    const laundryId = parseInt(req.params.laundryId, 10);
    if (isNaN(laundryId)) return res.status(400).json({ error: "Invalid laundry ID" });

    const logs = await db
      .select()
      .from(subscriptionLogs)
      .where(eq(subscriptionLogs.laundryId, laundryId))
      .orderBy(desc(subscriptionLogs.createdAt))
      .limit(50);

    res.json({ logs });
  } catch {
    res.status(500).json({ error: "Failed to fetch subscription logs" });
  }
});
