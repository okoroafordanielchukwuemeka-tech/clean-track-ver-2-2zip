import { Router } from "express";
import { db } from "@workspace/db";
import {
  notificationTemplates,
  notificationEvents,
  notificationMessages,
  notificationTemplates as tbl,
  DEFAULT_NOTIFICATION_TEMPLATES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TRIGGERS,
  providerConfigs,
  laundries,
  branches,
} from "@workspace/db/schema";
import { and, eq, desc, count, sql, or } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { requireEntitlement } from "../middleware/subscription.js";
import { providerRegistry } from "../lib/providers/registry.js";
import { WhatsAppCloudProvider, normalizePhoneE164 } from "../lib/providers/whatsapp-cloud.js";
import { interpolate } from "../lib/notification-dispatcher.js";

export const communicationRouter = Router();

// ─── Template validation ───────────────────────────────────────────────────

const templateCreateSchema = z.object({
  eventTrigger: z.enum(NOTIFICATION_EVENT_TRIGGERS),
  channel: z.enum(NOTIFICATION_CHANNELS),
  name: z.string().min(1).max(120),
  body: z.string().min(1).max(4096),
  branchId: z.number().int().nullable().optional(),
  variables: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

const templateUpdateSchema = templateCreateSchema.partial();

// ─── Seed default templates ────────────────────────────────────────────────

communicationRouter.post(
  "/templates/seed-defaults",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;

      const existing = await db
        .select({ id: notificationTemplates.id })
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.laundryId, laundryId),
            eq(notificationTemplates.isDefault, true)
          )
        );

      if (existing.length > 0) {
        return res.json({ seeded: 0, message: "Default templates already exist" });
      }

      const rows = DEFAULT_NOTIFICATION_TEMPLATES.map((t) => ({
        laundryId,
        branchId: null,
        eventTrigger: t.eventTrigger,
        channel: t.channel,
        name: t.name,
        body: t.body,
        variables: t.variables,
        isActive: true,
        isDefault: true,
      }));

      await db.insert(notificationTemplates).values(rows);
      res.json({ seeded: rows.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to seed default templates" });
    }
  }
);

// ─── List templates ────────────────────────────────────────────────────────

communicationRouter.get(
  "/templates",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const { channel, trigger, branchId } = req.query;

      const conditions: any[] = [eq(tbl.laundryId, laundryId)];
      if (channel) conditions.push(eq(tbl.channel, channel as string));
      if (trigger) conditions.push(eq(tbl.eventTrigger, trigger as string));
      if (branchId === "null") {
        conditions.push(sql`${tbl.branchId} IS NULL`);
      } else if (branchId) {
        conditions.push(eq(tbl.branchId, parseInt(branchId as string)));
      }

      const templates = await db
        .select({
          id: tbl.id,
          laundryId: tbl.laundryId,
          branchId: tbl.branchId,
          eventTrigger: tbl.eventTrigger,
          channel: tbl.channel,
          name: tbl.name,
          body: tbl.body,
          variables: tbl.variables,
          isActive: tbl.isActive,
          isDefault: tbl.isDefault,
          createdAt: tbl.createdAt,
          updatedAt: tbl.updatedAt,
        })
        .from(tbl)
        .where(and(...conditions))
        .orderBy(tbl.eventTrigger, tbl.channel, desc(tbl.createdAt));

      res.json(templates);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  }
);

// ─── Get single template ───────────────────────────────────────────────────

communicationRouter.get(
  "/templates/:id",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const id = parseInt(req.params.id);

      const [tmpl] = await db
        .select()
        .from(tbl)
        .where(and(eq(tbl.id, id), eq(tbl.laundryId, laundryId)));

      if (!tmpl) return res.status(404).json({ error: "Template not found" });
      res.json(tmpl);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch template" });
    }
  }
);

// ─── Create template ───────────────────────────────────────────────────────

communicationRouter.post(
  "/templates",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const parsed = templateCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
      }

      const { eventTrigger, channel, name, body, branchId, variables, isActive } =
        parsed.data;

      // Validate branchId belongs to this laundry
      if (branchId) {
        const [branch] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.id, branchId), eq(branches.laundryId, laundryId)));
        if (!branch) {
          return res.status(400).json({ error: "Branch not found" });
        }
      }

      const [tmpl] = await db
        .insert(tbl)
        .values({
          laundryId,
          branchId: branchId ?? null,
          eventTrigger,
          channel,
          name,
          body,
          variables: variables ?? [],
          isActive: isActive ?? true,
          isDefault: false,
        })
        .returning();

      res.status(201).json(tmpl);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create template" });
    }
  }
);

// ─── Update template ───────────────────────────────────────────────────────

communicationRouter.patch(
  "/templates/:id",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const id = parseInt(req.params.id);

      const parsed = templateUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
      }

      const existing = await db
        .select()
        .from(tbl)
        .where(and(eq(tbl.id, id), eq(tbl.laundryId, laundryId)));
      if (!existing.length) return res.status(404).json({ error: "Template not found" });

      const { branchId, ...rest } = parsed.data;

      const [updated] = await db
        .update(tbl)
        .set({
          ...rest,
          ...(branchId !== undefined ? { branchId } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(tbl.id, id), eq(tbl.laundryId, laundryId)))
        .returning();

      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update template" });
    }
  }
);

// ─── Delete template ───────────────────────────────────────────────────────

communicationRouter.delete(
  "/templates/:id",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const id = parseInt(req.params.id);

      const [tmpl] = await db
        .select()
        .from(tbl)
        .where(and(eq(tbl.id, id), eq(tbl.laundryId, laundryId)));
      if (!tmpl) return res.status(404).json({ error: "Template not found" });

      await db
        .delete(tbl)
        .where(and(eq(tbl.id, id), eq(tbl.laundryId, laundryId)));

      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete template" });
    }
  }
);

// ─── Message log ───────────────────────────────────────────────────────────

communicationRouter.get(
  "/messages",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const limitVal = Math.min(parseInt((req.query.limit as string) || "100"), 500);
      const offsetVal = parseInt((req.query.offset as string) || "0");
      const statusFilter = req.query.status as string | undefined;
      const channelFilter = req.query.channel as string | undefined;

      const conditions: any[] = [eq(notificationMessages.laundryId, laundryId)];
      if (statusFilter) conditions.push(eq(notificationMessages.status, statusFilter));
      if (channelFilter) conditions.push(eq(notificationMessages.channel, channelFilter));

      const [{ total }] = await db
        .select({ total: count() })
        .from(notificationMessages)
        .where(and(...conditions));

      const messages = await db
        .select({
          id: notificationMessages.id,
          eventId: notificationMessages.eventId,
          templateId: notificationMessages.templateId,
          channel: notificationMessages.channel,
          recipientPhone: notificationMessages.recipientPhone,
          recipientName: notificationMessages.recipientName,
          renderedBody: notificationMessages.renderedBody,
          status: notificationMessages.status,
          providerMessageId: notificationMessages.providerMessageId,
          retryCount: notificationMessages.retryCount,
          errorMessage: notificationMessages.errorMessage,
          queuedAt: notificationMessages.queuedAt,
          sentAt: notificationMessages.sentAt,
          deliveredAt: notificationMessages.deliveredAt,
          readAt: notificationMessages.readAt,
          failedAt: notificationMessages.failedAt,
        })
        .from(notificationMessages)
        .where(and(...conditions))
        .orderBy(desc(notificationMessages.queuedAt))
        .limit(limitVal)
        .offset(offsetVal);

      res.json({ messages, total });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch message log" });
    }
  }
);

// ─── Notification events log ───────────────────────────────────────────────

communicationRouter.get(
  "/events",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const limitVal = Math.min(parseInt((req.query.limit as string) || "100"), 500);
      const offsetVal = parseInt((req.query.offset as string) || "0");
      const statusFilter = req.query.status as string | undefined;

      const conditions: any[] = [eq(notificationEvents.laundryId, laundryId)];
      if (statusFilter) conditions.push(eq(notificationEvents.status, statusFilter));

      const [{ total }] = await db
        .select({ total: count() })
        .from(notificationEvents)
        .where(and(...conditions));

      const events = await db
        .select()
        .from(notificationEvents)
        .where(and(...conditions))
        .orderBy(desc(notificationEvents.createdAt))
        .limit(limitVal)
        .offset(offsetVal);

      res.json({ events, total });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch notification events" });
    }
  }
);

// ─── Message stats ─────────────────────────────────────────────────────────

communicationRouter.get(
  "/stats",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;

      const [statusCounts, channelCounts, templateCount, activeTemplateCount] = await Promise.all([
        db
          .select({ status: notificationMessages.status, count: count() })
          .from(notificationMessages)
          .where(eq(notificationMessages.laundryId, laundryId))
          .groupBy(notificationMessages.status),
        db
          .select({ channel: notificationMessages.channel, count: count() })
          .from(notificationMessages)
          .where(eq(notificationMessages.laundryId, laundryId))
          .groupBy(notificationMessages.channel),
        db
          .select({ count: count() })
          .from(notificationTemplates)
          .where(eq(notificationTemplates.laundryId, laundryId)),
        db
          .select({ count: count() })
          .from(notificationTemplates)
          .where(
            and(
              eq(notificationTemplates.laundryId, laundryId),
              eq(notificationTemplates.isActive, true)
            )
          ),
      ]);

      const total = statusCounts.reduce((s, r) => s + r.count, 0);

      res.json({
        total,
        byStatus: Object.fromEntries(statusCounts.map((r) => [r.status, r.count])),
        byChannel: Object.fromEntries(channelCounts.map((r) => [r.channel, r.count])),
        templates: { total: templateCount[0]?.count ?? 0, active: activeTemplateCount[0]?.count ?? 0 },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const waConfigSchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  businessAccountId: z.string().min(1),
  webhookVerifyToken: z.string().min(8),
  apiVersion: z.string().optional(),
});

// ─── GET /providers/whatsapp — get config (masked) ───────────────────────────

communicationRouter.get(
  "/providers/whatsapp",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;

      const [row] = await db
        .select()
        .from(providerConfigs)
        .where(
          and(
            eq(providerConfigs.laundryId, laundryId),
            eq(providerConfigs.provider, "whatsapp")
          )
        );

      if (!row) {
        return res.json({ isConfigured: false });
      }

      const cfg = row.config as Record<string, unknown>;

      // Mask the access token — show only last 4 chars
      const rawToken = (cfg.accessToken as string) ?? "";
      const maskedToken = rawToken.length > 4
        ? "•".repeat(rawToken.length - 4) + rawToken.slice(-4)
        : "•".repeat(rawToken.length);

      res.json({
        isConfigured: true,
        isActive: row.isActive,
        isVerified: row.isVerified,
        lastTestedAt: row.lastTestedAt,
        lastTestResult: row.lastTestResult,
        phoneNumberId: cfg.phoneNumberId ?? "",
        accessTokenSaved: rawToken.length > 0,
        accessTokenMasked: maskedToken,
        businessAccountId: cfg.businessAccountId ?? "",
        webhookVerifyToken: cfg.webhookVerifyToken ?? "",
        apiVersion: cfg.apiVersion ?? "v21.0",
        displayPhoneNumber: cfg.displayPhoneNumber,
        verifiedName: cfg.verifiedName,
        qualityRating: cfg.qualityRating,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch provider config" });
    }
  }
);

// ─── PUT /providers/whatsapp — save config ────────────────────────────────────

communicationRouter.put(
  "/providers/whatsapp",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const parsed = waConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
      }

      const { phoneNumberId, accessToken, businessAccountId, webhookVerifyToken, apiVersion } =
        parsed.data;

      // If access token is all bullets (user didn't change it), keep the old one
      const [existing] = await db
        .select()
        .from(providerConfigs)
        .where(
          and(
            eq(providerConfigs.laundryId, laundryId),
            eq(providerConfigs.provider, "whatsapp")
          )
        );

      const isMaskedToken = /^•+$/.test(accessToken) || accessToken === "saved";
      const finalToken =
        isMaskedToken && existing
          ? ((existing.config as Record<string, unknown>).accessToken as string)
          : accessToken;

      const newConfig: Record<string, unknown> = {
        phoneNumberId,
        accessToken: finalToken,
        businessAccountId,
        webhookVerifyToken,
        apiVersion: apiVersion ?? "v21.0",
      };

      // Preserve verification metadata
      if (existing) {
        const oldCfg = existing.config as Record<string, unknown>;
        if (oldCfg.displayPhoneNumber) newConfig.displayPhoneNumber = oldCfg.displayPhoneNumber;
        if (oldCfg.verifiedName) newConfig.verifiedName = oldCfg.verifiedName;
        if (oldCfg.qualityRating) newConfig.qualityRating = oldCfg.qualityRating;
      }

      if (existing) {
        await db
          .update(providerConfigs)
          .set({ config: newConfig, isVerified: false, updatedAt: new Date() })
          .where(eq(providerConfigs.id, existing.id));
      } else {
        await db.insert(providerConfigs).values({
          laundryId,
          provider: "whatsapp",
          config: newConfig,
          isActive: true,
          isVerified: false,
        });
      }

      providerRegistry.invalidate(laundryId, "whatsapp");
      res.json({ saved: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save provider config" });
    }
  }
);

// ─── POST /providers/whatsapp/validate — verify credentials via Meta API ─────

communicationRouter.post(
  "/providers/whatsapp/validate",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;

      const [row] = await db
        .select()
        .from(providerConfigs)
        .where(
          and(
            eq(providerConfigs.laundryId, laundryId),
            eq(providerConfigs.provider, "whatsapp")
          )
        );

      if (!row) {
        return res.status(400).json({ valid: false, error: "No WhatsApp config saved" });
      }

      const cfg = row.config as Parameters<typeof WhatsAppCloudProvider.prototype.validateConfiguration>[0] extends void
        ? never
        : Record<string, unknown>;

      const provider = new WhatsAppCloudProvider(cfg as any);
      const result = await provider.validateConfiguration();

      const now = new Date();
      const testResult = result.valid
        ? `Connected — ${(result.metadata as any)?.verifiedName ?? "OK"}`
        : `Failed — ${result.error}`;

      const configUpdate: Record<string, unknown> = {
        ...(row.config as Record<string, unknown>),
      };
      if (result.valid && result.metadata) {
        const m = result.metadata as any;
        configUpdate.displayPhoneNumber = m.displayPhoneNumber;
        configUpdate.verifiedName = m.verifiedName;
        configUpdate.qualityRating = m.qualityRating;
      }

      await db
        .update(providerConfigs)
        .set({
          isVerified: result.valid,
          isActive: result.valid,
          lastTestedAt: now,
          lastTestResult: testResult,
          config: configUpdate,
          updatedAt: now,
        })
        .where(eq(providerConfigs.id, row.id));

      providerRegistry.invalidate(laundryId, "whatsapp");
      res.json({ ...result, ...(result.metadata ?? {}) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ valid: false, error: "Validation request failed" });
    }
  }
);

// ─── DELETE /providers/whatsapp — remove config ───────────────────────────────

communicationRouter.delete(
  "/providers/whatsapp",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      await db
        .delete(providerConfigs)
        .where(
          and(
            eq(providerConfigs.laundryId, laundryId),
            eq(providerConfigs.provider, "whatsapp")
          )
        );
      providerRegistry.invalidate(laundryId, "whatsapp");
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete provider config" });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST MESSAGE
// ═══════════════════════════════════════════════════════════════════════════════

communicationRouter.post(
  "/test-message",
  requireOwner,
  requireEntitlement("HAS_WHATSAPP"),
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const { phone, body: rawBody } = req.body as { phone: string; body: string };

      if (!phone || !rawBody) {
        return res.status(400).json({ error: "phone and body are required" });
      }

      const provider = await providerRegistry.getProvider(laundryId, "whatsapp");
      if (!provider) {
        return res
          .status(400)
          .json({ success: false, error: "No active WhatsApp provider configured" });
      }

      // Insert a test message log entry
      const [msg] = await db
        .insert(notificationMessages)
        .values({
          laundryId,
          eventId: null,
          templateId: null,
          channel: "whatsapp",
          recipientPhone: normalizePhoneE164(phone),
          recipientName: "Test",
          renderedBody: rawBody,
          status: "queued",
          metadata: { isTest: true },
        })
        .returning();

      try {
        const result = await provider.send({ phone, body: rawBody });
        await db
          .update(notificationMessages)
          .set({ status: "sent", providerMessageId: result.providerMessageId ?? null, sentAt: new Date() })
          .where(eq(notificationMessages.id, msg.id));

        res.json({ success: true, providerMessageId: result.providerMessageId, messageId: msg.id });
      } catch (sendErr: unknown) {
        const errorMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        await db
          .update(notificationMessages)
          .set({ status: "failed", errorMessage: errorMsg, failedAt: new Date() })
          .where(eq(notificationMessages.id, msg.id));

        res.json({ success: false, error: errorMsg, messageId: msg.id });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Test message failed" });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY FAILED MESSAGE
// ═══════════════════════════════════════════════════════════════════════════════

communicationRouter.post(
  "/messages/:id/retry",
  requireOwner,
  async (req: AuthRequest, res) => {
    try {
      const { laundryId } = req.auth!;
      const id = parseInt(req.params.id);

      const [msg] = await db
        .select()
        .from(notificationMessages)
        .where(
          and(
            eq(notificationMessages.id, id),
            eq(notificationMessages.laundryId, laundryId)
          )
        );

      if (!msg) return res.status(404).json({ error: "Message not found" });
      if (msg.status !== "failed" && msg.status !== "queued") {
        return res.status(400).json({ error: `Cannot retry a message with status: ${msg.status}` });
      }

      const provider = await providerRegistry.getProvider(
        laundryId,
        msg.channel as any
      );
      if (!provider) {
        return res.json({ success: false, error: "No active provider for this channel" });
      }

      // Atomic optimistic-lock claim: only update if status hasn't changed since we read it.
      // Prevents double-send when two concurrent retry requests race on the same message.
      const [claimed] = await db
        .update(notificationMessages)
        .set({ status: "queued", retryCount: sql`${notificationMessages.retryCount} + 1`, errorMessage: null })
        .where(
          and(
            eq(notificationMessages.id, id),
            eq(notificationMessages.laundryId, laundryId),
            or(
              eq(notificationMessages.status, "failed"),
              eq(notificationMessages.status, "queued")
            )
          )
        )
        .returning({ id: notificationMessages.id });

      if (!claimed) {
        return res.status(409).json({ error: "Message was already claimed by a concurrent retry — try again" });
      }

      try {
        const result = await provider.send({
          phone: msg.recipientPhone,
          body: msg.renderedBody,
        });
        await db
          .update(notificationMessages)
          .set({
            status: "sent",
            providerMessageId: result.providerMessageId ?? null,
            sentAt: new Date(),
            failedAt: null,
          })
          .where(eq(notificationMessages.id, id));

        res.json({ success: true, providerMessageId: result.providerMessageId });
      } catch (sendErr: unknown) {
        const errorMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        await db
          .update(notificationMessages)
          .set({ status: "failed", errorMessage: errorMsg, failedAt: new Date() })
          .where(eq(notificationMessages.id, id));

        res.json({ success: false, error: errorMsg });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Retry failed" });
    }
  }
);
