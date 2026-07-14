/**
 * Campaign system — Professional+ and Enterprise only.
 * Handles bulk WhatsApp messaging to segmented customer audiences.
 *
 * Gate: requireEntitlement("HAS_WHATSAPP_CAMPAIGNS") on all mutating routes.
 * All routes are already behind requireOwner (set in index.ts).
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaigns,
  campaignRecipients,
  customers,
  branches,
  orders,
  laundries,
  type CampaignStatus,
} from "@workspace/db/schema";
import {
  and, eq, desc, ne, lt, isNull, isNotNull, sql, count, inArray, or,
} from "drizzle-orm";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth.js";
import { requireOperational, requireEntitlement } from "../middleware/subscription.js";
import { providerRegistry } from "../lib/providers/registry.js";
import { normalizePhoneE164 } from "../lib/providers/whatsapp-cloud.js";

export const campaignsRouter = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CAMPAIGN_TYPES = ["promotion", "reminder", "announcement", "holiday_greeting", "win_back", "custom"] as const;
const AUDIENCE_TYPES = [
  "all", "vip", "repeat", "inactive_30", "inactive_60", "inactive_90",
  "outstanding_balance", "ready_pickup", "completed_orders",
  "custom_tag", "custom_selection",
] as const;
const SCHEDULE_TYPES = ["now", "scheduled", "recurring_weekly", "recurring_monthly"] as const;

const campaignCreateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(CAMPAIGN_TYPES).default("promotion"),
  audienceType: z.enum(AUDIENCE_TYPES).default("all"),
  audienceFilter: z.any().optional(), // { tag?: string; customerIds?: number[] }
  messageTitle: z.string().max(200).optional(),
  messageBody: z.string().min(1).max(4096),
  scheduleType: z.enum(SCHEDULE_TYPES).default("now"),
  scheduledAt: z.string().datetime().optional().nullable(),
  timezone: z.string().default("Africa/Lagos"),
  branchId: z.number().int().optional().nullable(),
});

const campaignUpdateSchema = campaignCreateSchema.partial();

// ─── Audience resolution ──────────────────────────────────────────────────────

async function resolveAudience(
  laundryId: number,
  audienceType: string,
  audienceFilter: any,
  branchId: number | null | undefined,
): Promise<Array<{ id: number; fullName: string; phone: string }>> {
  const now = new Date();
  const conditions: any[] = [
    eq(customers.laundryId, laundryId),
    isNull(customers.deletedAt),
  ];

  if (branchId) conditions.push(eq(customers.branchId, branchId));

  switch (audienceType) {
    case "all": {
      return db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(...conditions));
    }

    case "vip": {
      // Customers whose tags JSON includes "VIP"
      return db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(...conditions, sql`${customers.tags} LIKE '%VIP%'`));
    }

    case "repeat": {
      // Customers with 2+ completed or picked-up orders
      const repeatCustomerIds = await db
        .select({ customerId: orders.customerId })
        .from(orders)
        .where(and(
          eq(orders.laundryId, laundryId),
          isNotNull(orders.customerId),
          or(eq(orders.status, "completed"), eq(orders.status, "partial_pickup")),
        ))
        .groupBy(orders.customerId)
        .having(sql`count(*) >= 2`);

      const ids = repeatCustomerIds.map((r) => r.customerId!).filter(Boolean);
      if (ids.length === 0) return [];

      return db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(...conditions, inArray(customers.id, ids)));
    }

    case "inactive_30":
    case "inactive_60":
    case "inactive_90": {
      const days = audienceType === "inactive_30" ? 30 : audienceType === "inactive_60" ? 60 : 90;
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      return db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(...conditions, lt(customers.lastActivityAt, cutoff)));
    }

    case "outstanding_balance": {
      // Customers with at least one unpaid or partially-paid order
      const customerIds = await db
        .select({ customerId: orders.customerId })
        .from(orders)
        .where(and(
          eq(orders.laundryId, laundryId),
          isNotNull(orders.customerId),
          or(eq(orders.paymentStatus, "unpaid"), eq(orders.paymentStatus, "partial")),
          ne(orders.status, "cancelled"),
        ))
        .groupBy(orders.customerId);

      const ids = customerIds.map((r) => r.customerId!).filter(Boolean);
      if (ids.length === 0) return [];

      return db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(...conditions, inArray(customers.id, ids)));
    }

    case "ready_pickup": {
      const customerIds = await db
        .select({ customerId: orders.customerId })
        .from(orders)
        .where(and(
          eq(orders.laundryId, laundryId),
          isNotNull(orders.customerId),
          or(eq(orders.status, "ready"), eq(orders.status, "partial_pickup")),
        ))
        .groupBy(orders.customerId);

      const ids = customerIds.map((r) => r.customerId!).filter(Boolean);
      if (ids.length === 0) return [];

      return db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(...conditions, inArray(customers.id, ids)));
    }

    case "completed_orders": {
      const customerIds = await db
        .select({ customerId: orders.customerId })
        .from(orders)
        .where(and(
          eq(orders.laundryId, laundryId),
          isNotNull(orders.customerId),
          eq(orders.status, "completed"),
        ))
        .groupBy(orders.customerId);

      const ids = customerIds.map((r) => r.customerId!).filter(Boolean);
      if (ids.length === 0) return [];

      return db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(...conditions, inArray(customers.id, ids)));
    }

    case "custom_tag": {
      const tag = audienceFilter?.tag ?? "";
      if (!tag) return [];
      return db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(...conditions, sql`${customers.tags} LIKE ${`%${tag}%`}`));
    }

    case "custom_selection": {
      const ids: number[] = (audienceFilter?.customerIds ?? []).map(Number).filter(Boolean);
      if (ids.length === 0) return [];
      return db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(...conditions, inArray(customers.id, ids)));
    }

    default:
      return [];
  }
}

// ─── Message rendering ────────────────────────────────────────────────────────

function renderMessage(
  template: string,
  vars: {
    customerName: string;
    businessName: string;
    balance?: string;
    orderNumber?: string;
    pickupDate?: string;
  },
): string {
  return template
    .replace(/\{\{customerName\}\}/gi, vars.customerName)
    .replace(/\{\{businessName\}\}/gi, vars.businessName)
    .replace(/\{\{balance\}\}/gi, vars.balance ?? "")
    .replace(/\{\{orderNumber\}\}/gi, vars.orderNumber ?? "")
    .replace(/\{\{pickupDate\}\}/gi, vars.pickupDate ?? "");
}

// ─── Background send processor ────────────────────────────────────────────────

/**
 * Processes campaign send in background.
 * Uses batch DB updates to efficiently handle large audiences (10k+).
 *   - No provider: one bulk UPDATE → all "failed"
 *   - Provider present: parallel batches of CONCURRENT_SENDS, then bulk UPDATE results
 */
const CONCURRENT_SENDS = 50;
const BATCH_SIZE = 500;

async function processCampaignSend(campaignId: number, laundryId: number): Promise<void> {
  const now = new Date();
  try {
    const provider = await providerRegistry.getProvider(laundryId, "whatsapp");

    if (!provider) {
      // Fast path: no WhatsApp provider — bulk-fail all recipients in one query
      await db.update(campaignRecipients).set({
        status: "failed",
        failedAt: now,
        errorMessage: "No active WhatsApp provider configured",
        retries: 1,
      }).where(and(
        eq(campaignRecipients.campaignId, campaignId),
        eq(campaignRecipients.status, "queued"),
      ));

      const [{ failedCount }] = await db
        .select({ failedCount: count() })
        .from(campaignRecipients)
        .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "failed")));

      await db.update(campaigns).set({
        status: "failed",
        sentAt: now,
        completedAt: now,
        delivered: 0,
        failed: Number(failedCount),
        updatedAt: now,
      }).where(eq(campaigns.id, campaignId));
      return;
    }

    // Provider present: process in parallel batches
    // Fetch IDs only first for memory efficiency
    const allRecipients = await db
      .select({ id: campaignRecipients.id, phone: campaignRecipients.phone, message: campaignRecipients.message })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "queued")));

    const deliveredIds: number[] = [];
    const failedIds: number[] = [];
    const errorMsg = "Send failed";

    // Mark all as "sending" in one batch query
    await db.update(campaignRecipients).set({ status: "sending" })
      .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "queued")));

    // Process in concurrent batches
    for (let i = 0; i < allRecipients.length; i += CONCURRENT_SENDS) {
      const batch = allRecipients.slice(i, i + CONCURRENT_SENDS);
      await Promise.all(batch.map(async (r) => {
        try {
          const normalized = normalizePhoneE164(r.phone);
          await provider.send({ phone: normalized, body: r.message });
          deliveredIds.push(r.id);
        } catch {
          failedIds.push(r.id);
        }
      }));
    }

    const deliveredNow = now;
    // Batch-update delivered in chunks
    for (let i = 0; i < deliveredIds.length; i += BATCH_SIZE) {
      await db.update(campaignRecipients).set({
        status: "delivered", sentAt: deliveredNow, deliveredAt: deliveredNow,
      }).where(and(eq(campaignRecipients.campaignId, campaignId), inArray(campaignRecipients.id, deliveredIds.slice(i, i + BATCH_SIZE))));
    }
    // Batch-update failed in chunks
    for (let i = 0; i < failedIds.length; i += BATCH_SIZE) {
      await db.update(campaignRecipients).set({
        status: "failed", failedAt: now, errorMessage: errorMsg,
      }).where(and(eq(campaignRecipients.campaignId, campaignId), inArray(campaignRecipients.id, failedIds.slice(i, i + BATCH_SIZE))));
    }

    const newStatus: CampaignStatus = deliveredIds.length === 0 ? "failed" : "sent";
    await db.update(campaigns).set({
      status: newStatus,
      sentAt: now,
      completedAt: now,
      delivered: deliveredIds.length,
      failed: failedIds.length,
      updatedAt: now,
    }).where(eq(campaigns.id, campaignId));
  } catch (err) {
    console.error(`[campaigns] processCampaignSend error for campaign ${campaignId}:`, err);
    await db.update(campaigns).set({
      status: "failed", completedAt: now, updatedAt: now,
    }).where(eq(campaigns.id, campaignId));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIENCE PREVIEW  (Pro+)
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.post("/preview-audience", requireEntitlement("HAS_WHATSAPP_CAMPAIGNS"), async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const { audienceType, audienceFilter, branchId } = req.body;

    if (!audienceType) return res.status(400).json({ error: "audienceType is required" });

    const audience = await resolveAudience(laundryId, audienceType, audienceFilter, branchId);
    res.json({ count: audience.length, sample: audience.slice(0, 5).map((c) => ({ id: c.id, name: c.fullName, phone: c.phone.slice(-4).padStart(c.phone.length, "*") })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to preview audience" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIST CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const { status, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions: any[] = [eq(campaigns.laundryId, laundryId)];
    if (status) conditions.push(eq(campaigns.status, status as CampaignStatus));

    const rows = await db
      .select()
      .from(campaigns)
      .where(and(...conditions))
      .orderBy(desc(campaigns.createdAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list campaigns" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGN HISTORY (alias for list with completed statuses)
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.get("/history", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;

    const rows = await db
      .select()
      .from(campaigns)
      .where(and(
        eq(campaigns.laundryId, laundryId),
        or(
          eq(campaigns.status, "sent"),
          eq(campaigns.status, "failed"),
          eq(campaigns.status, "cancelled"),
        ),
      ))
      .orderBy(desc(campaigns.sentAt));

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch campaign history" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET CAMPAIGN
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.get("/:id", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);

    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.laundryId, laundryId)));

    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    // Include recipient breakdown
    const recipientStats = await db
      .select({
        status: campaignRecipients.status,
        cnt: count(),
      })
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, id))
      .groupBy(campaignRecipients.status);

    res.json({ ...campaign, recipientStats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch campaign" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE CAMPAIGN  (Pro+)
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.post("/", requireOperational, requireEntitlement("HAS_WHATSAPP_CAMPAIGNS"), async (req: AuthRequest, res) => {
  try {
    const { laundryId, ownerId } = req.auth!;

    const parsed = campaignCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const data = parsed.data;

    // Validate branchId belongs to this laundry
    if (data.branchId) {
      const [branch] = await db.select({ id: branches.id }).from(branches)
        .where(and(eq(branches.id, data.branchId), eq(branches.laundryId, laundryId)));
      if (!branch) return res.status(400).json({ error: "Invalid branchId" });
    }

    const [campaign] = await db.insert(campaigns).values({
      laundryId,
      branchId: data.branchId ?? null,
      name: data.name,
      type: data.type,
      audienceType: data.audienceType,
      audienceFilter: data.audienceFilter ? JSON.stringify(data.audienceFilter) : null,
      messageTitle: data.messageTitle ?? null,
      messageBody: data.messageBody,
      scheduleType: data.scheduleType,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      timezone: data.timezone,
      status: "draft",
      createdById: ownerId!,
    }).returning();

    res.status(201).json(campaign);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE CAMPAIGN  (Pro+, draft only)
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.patch("/:id", requireEntitlement("HAS_WHATSAPP_CAMPAIGNS"), async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);

    const [existing] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.laundryId, laundryId)));
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    if (!["draft", "scheduled"].includes(existing.status)) {
      return res.status(409).json({ error: "Only draft or scheduled campaigns can be edited" });
    }

    const parsed = campaignUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

    const data = parsed.data;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.type !== undefined) updates.type = data.type;
    if (data.audienceType !== undefined) updates.audienceType = data.audienceType;
    if (data.audienceFilter !== undefined) updates.audienceFilter = data.audienceFilter ? JSON.stringify(data.audienceFilter) : null;
    if (data.messageTitle !== undefined) updates.messageTitle = data.messageTitle;
    if (data.messageBody !== undefined) updates.messageBody = data.messageBody;
    if (data.scheduleType !== undefined) updates.scheduleType = data.scheduleType;
    if (data.scheduledAt !== undefined) updates.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
    if (data.timezone !== undefined) updates.timezone = data.timezone;
    if (data.branchId !== undefined) updates.branchId = data.branchId;

    const [updated] = await db.update(campaigns).set(updates)
      .where(and(eq(campaigns.id, id), eq(campaigns.laundryId, laundryId)))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update campaign" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE CAMPAIGN  (draft only)
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);

    const [existing] = await db.select({ id: campaigns.id, status: campaigns.status })
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.laundryId, laundryId)));

    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    if (!["draft", "scheduled", "cancelled", "failed"].includes(existing.status)) {
      return res.status(409).json({ error: "Only draft, scheduled, cancelled, or failed campaigns can be deleted" });
    }

    await db.delete(campaigns).where(eq(campaigns.id, id));
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete campaign" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEND CAMPAIGN  (Pro+)
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.post("/:id/send", requireOperational, requireEntitlement("HAS_WHATSAPP_CAMPAIGNS"), async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);

    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.laundryId, laundryId)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (!["draft", "scheduled"].includes(campaign.status)) {
      return res.status(409).json({ error: "Campaign cannot be sent in its current state" });
    }

    // Fetch business name for variable rendering
    const [laundry] = await db.select({ businessName: laundries.businessName })
      .from(laundries).where(eq(laundries.id, laundryId));
    const businessName = laundry?.businessName ?? "Your Laundry";

    // Resolve audience
    const audienceFilter = campaign.audienceFilter ? JSON.parse(campaign.audienceFilter) : null;
    const audience = await resolveAudience(
      laundryId,
      campaign.audienceType,
      audienceFilter,
      campaign.branchId,
    );

    if (audience.length === 0) {
      return res.status(422).json({ error: "No recipients matched the selected audience" });
    }

    // Delete any existing recipient rows (safe to re-send from draft)
    await db.delete(campaignRecipients).where(eq(campaignRecipients.campaignId, id));

    // Create recipient rows
    const recipientRows = audience.map((c) => ({
      campaignId: id,
      customerId: c.id,
      customerName: c.fullName,
      phone: c.phone,
      message: renderMessage(campaign.messageBody, {
        customerName: c.fullName,
        businessName,
      }),
      status: "queued" as const,
    }));

    // Insert in batches of 500
    for (let i = 0; i < recipientRows.length; i += 500) {
      await db.insert(campaignRecipients).values(recipientRows.slice(i, i + 500));
    }

    // Update campaign status to queued
    await db.update(campaigns).set({
      status: "queued",
      totalRecipients: audience.length,
      delivered: 0,
      failed: 0,
      cancelled: 0,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, id));

    // Fire and forget — process in background
    setImmediate(() => processCampaignSend(id, laundryId));

    res.json({
      campaignId: id,
      totalRecipients: audience.length,
      message: `Campaign queued for ${audience.length} recipient${audience.length !== 1 ? "s" : ""}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send campaign" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CANCEL CAMPAIGN
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.post("/:id/cancel", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);

    const [campaign] = await db.select({ id: campaigns.id, status: campaigns.status })
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.laundryId, laundryId)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (["sent", "cancelled", "failed"].includes(campaign.status)) {
      return res.status(409).json({ error: "Campaign cannot be cancelled in its current state" });
    }

    // Cancel all queued recipients
    const { rowCount } = await db.update(campaignRecipients).set({
      status: "cancelled",
    }).where(and(
      eq(campaignRecipients.campaignId, id),
      eq(campaignRecipients.status, "queued"),
    ));

    await db.update(campaigns).set({
      status: "cancelled",
      cancelled: rowCount ?? 0,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, id));

    res.json({ cancelled: true, recipientsCancelled: rowCount ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to cancel campaign" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY FAILED CAMPAIGN  (Pro+)
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.post("/:id/retry", requireEntitlement("HAS_WHATSAPP_CAMPAIGNS"), async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);

    const [campaign] = await db.select().from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.laundryId, laundryId)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (!["sent", "failed"].includes(campaign.status)) {
      return res.status(409).json({ error: "Can only retry sent or failed campaigns" });
    }

    // Reset failed recipients to queued
    const { rowCount } = await db.update(campaignRecipients).set({
      status: "queued",
      errorMessage: null,
      failedAt: null,
    }).where(and(
      eq(campaignRecipients.campaignId, id),
      eq(campaignRecipients.status, "failed"),
    ));

    if (!rowCount || rowCount === 0) {
      return res.status(422).json({ error: "No failed recipients to retry" });
    }

    await db.update(campaigns).set({
      status: "queued",
      failed: 0,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, id));

    setImmediate(() => processCampaignSend(id, laundryId));

    res.json({ retrying: true, recipientsQueued: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to retry campaign" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET RECIPIENTS  (for campaign detail view)
// ═══════════════════════════════════════════════════════════════════════════════

campaignsRouter.get("/:id/recipients", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);
    const { status, limit = "100", offset = "0" } = req.query as Record<string, string>;

    const [campaign] = await db.select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.laundryId, laundryId)));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const conditions: any[] = [eq(campaignRecipients.campaignId, id)];
    if (status) conditions.push(eq(campaignRecipients.status, status as any));

    const rows = await db
      .select()
      .from(campaignRecipients)
      .where(and(...conditions))
      .orderBy(desc(campaignRecipients.createdAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch recipients" });
  }
});
