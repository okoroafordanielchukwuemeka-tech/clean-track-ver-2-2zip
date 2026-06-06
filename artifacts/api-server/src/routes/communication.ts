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
  laundries,
  branches,
} from "@workspace/db/schema";
import { and, eq, desc, count, sql } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";

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

      const statusCounts = await db
        .select({
          status: notificationMessages.status,
          count: count(),
        })
        .from(notificationMessages)
        .where(eq(notificationMessages.laundryId, laundryId))
        .groupBy(notificationMessages.status);

      const channelCounts = await db
        .select({
          channel: notificationMessages.channel,
          count: count(),
        })
        .from(notificationMessages)
        .where(eq(notificationMessages.laundryId, laundryId))
        .groupBy(notificationMessages.channel);

      const templateCount = await db
        .select({ count: count() })
        .from(notificationTemplates)
        .where(eq(notificationTemplates.laundryId, laundryId));

      const activeTemplateCount = await db
        .select({ count: count() })
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.laundryId, laundryId),
            eq(notificationTemplates.isActive, true)
          )
        );

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
