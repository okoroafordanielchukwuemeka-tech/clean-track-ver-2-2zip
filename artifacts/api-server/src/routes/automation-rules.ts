/**
 * Automation Rules CRUD
 *
 * GET    /api/automation-rules          — list all rules for the laundry
 * PATCH  /api/automation-rules/:id      — toggle or update a rule
 * POST   /api/automation-rules/initialize — seed defaults (idempotent)
 *
 * Security:
 *  - All reads require requireAuth.
 *  - Writes require requireOwner or checkPermission("manage:whatsapp").
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { automationRules } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireOwner } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { initializeDefaultRules } from "../lib/automation-service.js";

export const automationRulesRouter = Router();

// ── GET /api/automation-rules ──────────────────────────────────────────────────
// Returns all 5 rules for this laundry, sorted by trigger event name.

automationRulesRouter.get(
  "/",
  requireAuth,
  checkPermission("view:whatsapp"),
  async (req: AuthRequest, res) => {
    const { laundryId } = req.auth!;
    try {
      const rules = await db
        .select()
        .from(automationRules)
        .where(eq(automationRules.laundryId, laundryId))
        .orderBy(automationRules.triggerEvent);
      return res.json({ rules });
    } catch (err) {
      console.error("[automation-rules] GET / error:", err);
      return res.status(500).json({ error: "Failed to fetch automation rules" });
    }
  }
);

// ── POST /api/automation-rules/initialize ─────────────────────────────────────
// Creates the 5 default rules for this laundry (idempotent).
// Must be registered BEFORE /:id to avoid Express matching "initialize" as an ID.

automationRulesRouter.post(
  "/initialize",
  requireOwner,
  async (req: AuthRequest, res) => {
    const { laundryId } = req.auth!;
    try {
      await initializeDefaultRules(laundryId);
      const rules = await db
        .select()
        .from(automationRules)
        .where(eq(automationRules.laundryId, laundryId))
        .orderBy(automationRules.triggerEvent);
      return res.json({ ok: true, rules });
    } catch (err) {
      console.error("[automation-rules] POST /initialize error:", err);
      return res.status(500).json({ error: "Failed to initialize automation rules" });
    }
  }
);

// ── PATCH /api/automation-rules/:id ───────────────────────────────────────────
// Toggle enabled or update the message template.

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  messageTemplate: z.string().min(1).max(2000).trim().optional(),
  name: z.string().min(1).max(200).trim().optional(),
});

automationRulesRouter.patch(
  "/:id",
  requireAuth,
  checkPermission("manage:whatsapp"),
  async (req: AuthRequest, res) => {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid rule ID" });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid update data" });

    const { enabled, messageTemplate, name } = parsed.data;
    if (enabled === undefined && messageTemplate === undefined && name === undefined) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    try {
      const [existing] = await db
        .select({ id: automationRules.id })
        .from(automationRules)
        .where(
          and(eq(automationRules.id, id), eq(automationRules.laundryId, laundryId))
        );

      if (!existing) return res.status(404).json({ error: "Rule not found" });

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (enabled !== undefined) updateData.enabled = enabled;
      if (messageTemplate !== undefined) updateData.messageTemplate = messageTemplate;
      if (name !== undefined) updateData.name = name;

      const [updated] = await db
        .update(automationRules)
        .set(updateData)
        .where(and(eq(automationRules.id, id), eq(automationRules.laundryId, laundryId)))
        .returning();

      return res.json({ rule: updated });
    } catch (err) {
      console.error("[automation-rules] PATCH /:id error:", err);
      return res.status(500).json({ error: "Failed to update rule" });
    }
  }
);
