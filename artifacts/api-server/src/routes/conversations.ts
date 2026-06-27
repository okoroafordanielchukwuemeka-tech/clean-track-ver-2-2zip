/**
 * Conversations API
 *
 * Provides access to WhatsApp (and future SMS) conversation threads.
 * Workers can view conversations; only owners can resolve/archive.
 *
 * All routes enforce laundryId scoping via the JWT — no cross-tenant access.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  conversations,
  conversationMessages,
  customers,
} from "@workspace/db/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireOwner } from "../middleware/auth.js";

export const conversationsRouter = Router();

// ── GET /api/conversations ─────────────────────────────────────────────────
// Lists all conversations for this laundry, newest first.
// Supports ?status=open|resolved|archived and ?limit=&offset=

conversationsRouter.get("/", requireAuth, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;

  const statusFilter = req.query.status as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const conditions = [eq(conversations.laundryId, laundryId)];
    if (statusFilter && ["open", "resolved", "archived"].includes(statusFilter)) {
      conditions.push(eq(conversations.status, statusFilter as "open" | "resolved" | "archived"));
    }

    const rows = await db
      .select({
        id: conversations.id,
        customerId: conversations.customerId,
        customerName: conversations.customerName,
        customerPhone: conversations.customerPhone,
        channel: conversations.channel,
        status: conversations.status,
        unreadCount: conversations.unreadCount,
        lastMessageAt: conversations.lastMessageAt,
        assignedWorkerId: conversations.assignedWorkerId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limit)
      .offset(offset);

    // Total count for pagination
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(...conditions));

    // Total unread across all open conversations (for badge)
    const [{ totalUnread }] = await db
      .select({ totalUnread: sql<number>`coalesce(sum(unread_count),0)::int` })
      .from(conversations)
      .where(
        and(
          eq(conversations.laundryId, laundryId),
          eq(conversations.status, "open")
        )
      );

    return res.json({ conversations: rows, total: count, totalUnread });
  } catch (err) {
    console.error("[conversations] GET / error:", err);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// ── GET /api/conversations/unread-count ────────────────────────────────────
// Lightweight endpoint for the notification badge.

conversationsRouter.get("/unread-count", requireAuth, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;
  try {
    const [{ totalUnread }] = await db
      .select({ totalUnread: sql<number>`coalesce(sum(unread_count),0)::int` })
      .from(conversations)
      .where(
        and(
          eq(conversations.laundryId, laundryId),
          eq(conversations.status, "open")
        )
      );
    return res.json({ unreadCount: totalUnread });
  } catch (err) {
    console.error("[conversations] GET /unread-count error:", err);
    return res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// ── GET /api/conversations/:id ─────────────────────────────────────────────
// Returns a single conversation with its most recent messages (newest last).

conversationsRouter.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.laundryId, laundryId)));

    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    // Fetch linked customer for order context
    let customer = null;
    if (conv.customerId) {
      const [c] = await db
        .select({
          id: customers.id,
          fullName: customers.fullName,
          phone: customers.phone,
        })
        .from(customers)
        .where(and(eq(customers.id, conv.customerId), eq(customers.laundryId, laundryId)));
      customer = c ?? null;
    }

    const messages = await db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, id),
          eq(conversationMessages.laundryId, laundryId)
        )
      )
      .orderBy(asc(conversationMessages.createdAt))
      .limit(limit);

    return res.json({ conversation: conv, messages, customer });
  } catch (err) {
    console.error("[conversations] GET /:id error:", err);
    return res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// ── PATCH /api/conversations/:id/read ─────────────────────────────────────
// Marks a conversation as read (clears unreadCount).

conversationsRouter.patch("/:id/read", requireAuth, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

  try {
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.laundryId, laundryId)));

    if (!existing) return res.status(404).json({ error: "Conversation not found" });

    await db
      .update(conversations)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(eq(conversations.id, id));

    return res.json({ ok: true });
  } catch (err) {
    console.error("[conversations] PATCH /:id/read error:", err);
    return res.status(500).json({ error: "Failed to mark as read" });
  }
});

// ── PATCH /api/conversations/:id/status ───────────────────────────────────
// Owners can change conversation status: open | resolved | archived.

const statusSchema = z.object({
  status: z.enum(["open", "resolved", "archived"]),
});

conversationsRouter.patch("/:id/status", requireOwner, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid status" });

  try {
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.laundryId, laundryId)));

    if (!existing) return res.status(404).json({ error: "Conversation not found" });

    await db
      .update(conversations)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(conversations.id, id));

    return res.json({ ok: true, status: parsed.data.status });
  } catch (err) {
    console.error("[conversations] PATCH /:id/status error:", err);
    return res.status(500).json({ error: "Failed to update conversation status" });
  }
});
