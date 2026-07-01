/**
 * Conversations API
 *
 * Full shared inbox for WhatsApp (and future channel) conversations.
 * - Workers can view conversations and send replies.
 * - Only owners can resolve/archive/assign.
 * - All routes enforce laundryId scoping — no cross-tenant access.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  conversations,
  conversationMessages,
  customers,
  orders,
  workers,
} from "@workspace/db/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireOwner } from "../middleware/auth.js";
import { checkPermission } from "../middleware/permissions.js";
import { providerRegistry } from "../lib/providers/registry.js";

export const conversationsRouter = Router();

// ── GET /api/conversations ─────────────────────────────────────────────────
// Lists conversations for this laundry, newest-first.
// ?status=open|resolved|archived  ?limit=  ?offset=
// Includes lastMessageBody and lastMessageDirection via DISTINCT ON subquery.

conversationsRouter.get("/", requireAuth, checkPermission("view:whatsapp"), async (req: AuthRequest, res) => {
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

    // Enrich with last message body for preview in conversation list
    const lastMessages: Record<number, { body: string; direction: string }> = {};
    if (rows.length > 0) {
      const convIds = rows.map(r => r.id);
      const idsStr = convIds.join(",");
      const lastMsgResult = await db.execute(sql`
        SELECT DISTINCT ON (conversation_id)
          conversation_id, body, direction
        FROM conversation_messages
        WHERE conversation_id = ANY(ARRAY[${sql.raw(idsStr)}]::int[])
        ORDER BY conversation_id, created_at DESC
      `);
      for (const row of lastMsgResult.rows as Array<{ conversation_id: number; body: string; direction: string }>) {
        lastMessages[row.conversation_id] = { body: row.body, direction: row.direction };
      }
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(...conditions));

    const [{ totalUnread }] = await db
      .select({ totalUnread: sql<number>`coalesce(sum(unread_count),0)::int` })
      .from(conversations)
      .where(and(eq(conversations.laundryId, laundryId), eq(conversations.status, "open")));

    const enriched = rows.map(r => ({
      ...r,
      lastMessageBody: lastMessages[r.id]?.body ?? null,
      lastMessageDirection: lastMessages[r.id]?.direction ?? null,
    }));

    return res.json({ conversations: enriched, total: count, totalUnread });
  } catch (err) {
    console.error("[conversations] GET / error:", err);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// ── GET /api/conversations/unread-count ────────────────────────────────────

conversationsRouter.get("/unread-count", requireAuth, checkPermission("view:whatsapp"), async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;
  try {
    const [{ totalUnread }] = await db
      .select({ totalUnread: sql<number>`coalesce(sum(unread_count),0)::int` })
      .from(conversations)
      .where(and(eq(conversations.laundryId, laundryId), eq(conversations.status, "open")));
    return res.json({ unreadCount: totalUnread });
  } catch (err) {
    console.error("[conversations] GET /unread-count error:", err);
    return res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// ── GET /api/conversations/:id ─────────────────────────────────────────────
// Returns conversation + messages + enriched customer (orders + balance).

conversationsRouter.get("/:id", requireAuth, checkPermission("view:whatsapp"), async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

  const msgLimit = Math.min(parseInt(req.query.limit as string) || 100, 500);

  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.laundryId, laundryId)));

    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const messages = await db
      .select()
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.conversationId, id),
        eq(conversationMessages.laundryId, laundryId)
      ))
      .orderBy(asc(conversationMessages.createdAt))
      .limit(msgLimit);

    let customer = null;
    if (conv.customerId) {
      const [c] = await db
        .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
        .from(customers)
        .where(and(eq(customers.id, conv.customerId), eq(customers.laundryId, laundryId)));

      if (c) {
        // Fetch customer orders for context panel
        const customerOrders = await db
          .select({
            id: orders.id,
            orderId: orders.orderId,
            status: orders.status,
            paymentStatus: orders.paymentStatus,
            price: orders.price,
            amountPaid: orders.amountPaid,
            createdAt: orders.createdAt,
            serviceType: orders.serviceType,
            branchId: orders.branchId,
            customerName: orders.customerName,
          })
          .from(orders)
          .where(and(eq(orders.customerId, conv.customerId!), eq(orders.laundryId, laundryId)))
          .orderBy(desc(orders.createdAt))
          .limit(20);

        const outstandingBalance = customerOrders
          .filter(o => o.paymentStatus !== "paid")
          .reduce((sum, o) => {
            const due = parseFloat(o.price || "0");
            const paid = parseFloat(o.amountPaid || "0");
            return sum + Math.max(0, due - paid);
          }, 0);

        const totalSpent = customerOrders.reduce((sum, o) => {
          return sum + parseFloat(o.amountPaid || "0");
        }, 0);

        const activeOrders = customerOrders
          .filter(o => o.status !== "completed")
          .slice(0, 5);

        const recentOrders = customerOrders.slice(0, 5);

        const lastOrderAt = customerOrders.length > 0 ? customerOrders[0].createdAt : null;

        customer = {
          ...c,
          totalOrders: customerOrders.length,
          outstandingBalance,
          totalSpent,
          lastOrderAt,
          activeOrders,
          recentOrders,
        };
      }
    }

    // Fetch assigned worker info if set
    let assignedWorker = null;
    if (conv.assignedWorkerId) {
      const [w] = await db
        .select({ id: workers.id, name: workers.name, role: workers.role })
        .from(workers)
        .where(and(eq(workers.id, conv.assignedWorkerId), eq(workers.laundryId, laundryId)));
      assignedWorker = w ?? null;
    }

    return res.json({ conversation: conv, messages, customer, assignedWorker });
  } catch (err) {
    console.error("[conversations] GET /:id error:", err);
    return res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// ── POST /api/conversations/:id/messages ───────────────────────────────────
// Saves a reply from the owner/worker and attempts WhatsApp delivery.
// Gracefully degrades: message is always saved even if delivery fails.

const replySchema = z.object({
  body: z.string().min(1).max(4096).trim(),
});

conversationsRouter.post("/:id/messages", requireAuth, checkPermission("reply:whatsapp"), async (req: AuthRequest, res) => {
  const { laundryId, type, name } = req.auth!;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message body required" });

  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.laundryId, laundryId)));

    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const senderType = type === "owner" ? "owner" : "worker";
    const senderId: number | null =
      type === "owner"
        ? ((req.auth as any).ownerId ?? null)
        : ((req.auth as any).workerId ?? null);
    const senderName = name ?? "CleanTrack";

    const [saved] = await db
      .insert(conversationMessages)
      .values({
        conversationId: id,
        laundryId,
        direction: "outbound",
        body: parsed.data.body,
        senderType,
        senderId,
        senderName,
        status: "queued",
      })
      .returning();

    // Re-open conversation if it was resolved/archived
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date(), status: "open" })
      .where(eq(conversations.id, id));

    // Attempt WhatsApp delivery (non-blocking)
    let deliveryStatus = "queued";
    let providerMessageId: string | null = null;

    try {
      const provider = await providerRegistry.getProvider(laundryId, "whatsapp");
      if (provider) {
        const result = await provider.send({
          phone: conv.customerPhone,
          body: parsed.data.body,
        });
        deliveryStatus = "sent";
        providerMessageId = result.providerMessageId ?? null;
        await db
          .update(conversationMessages)
          .set({ status: "sent", providerMessageId })
          .where(eq(conversationMessages.id, saved.id));
      }
    } catch (sendErr) {
      console.error(`[conversations] WhatsApp delivery failed for msg ${saved.id}:`, sendErr);
      // Not fatal — message saved locally regardless
    }

    return res.json({
      message: { ...saved, status: deliveryStatus, providerMessageId },
      delivered: deliveryStatus === "sent",
    });
  } catch (err) {
    console.error("[conversations] POST /:id/messages error:", err);
    return res.status(500).json({ error: "Failed to send reply" });
  }
});

// ── PATCH /api/conversations/:id/read ─────────────────────────────────────

conversationsRouter.patch("/:id/read", requireAuth, checkPermission("view:whatsapp"), async (req: AuthRequest, res) => {
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

const statusSchema = z.object({
  status: z.enum(["open", "resolved", "archived"]),
});

conversationsRouter.patch("/:id/status", requireAuth, checkPermission("manage:whatsapp"), async (req: AuthRequest, res) => {
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

// ── POST /api/conversations/:id/notes ──────────────────────────────────────
// Saves an internal note on a conversation. NOT sent to the customer.
// Marked with metadata.note = true so the frontend can style it differently.

const noteSchema = z.object({
  body: z.string().min(1).max(4096).trim(),
});

conversationsRouter.post("/:id/notes", requireAuth, checkPermission("reply:whatsapp"), async (req: AuthRequest, res) => {
  const { laundryId, type, name } = req.auth!;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Note body required" });

  try {
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.laundryId, laundryId)));

    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const senderType = type === "owner" ? "owner" : "worker";
    const senderId: number | null =
      type === "owner"
        ? ((req.auth as any).ownerId ?? null)
        : ((req.auth as any).workerId ?? null);
    const senderName = name ?? "CleanTrack";

    const [saved] = await db
      .insert(conversationMessages)
      .values({
        conversationId: id,
        laundryId,
        direction: "outbound",
        body: parsed.data.body,
        senderType,
        senderId,
        senderName,
        status: "sent",
        metadata: { note: true },
      })
      .returning();

    return res.json({ message: saved });
  } catch (err) {
    console.error("[conversations] POST /:id/notes error:", err);
    return res.status(500).json({ error: "Failed to save note" });
  }
});

// ── PATCH /api/conversations/:id/assign ───────────────────────────────────
// Assigns (or unassigns) a conversation to a worker. Owner only.

const assignSchema = z.object({
  workerId: z.number().int().nullable(),
});

conversationsRouter.patch("/:id/assign", requireOwner, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid conversation ID" });

  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid workerId" });

  try {
    if (parsed.data.workerId !== null) {
      const [worker] = await db
        .select({ id: workers.id })
        .from(workers)
        .where(and(eq(workers.id, parsed.data.workerId), eq(workers.laundryId, laundryId)));
      if (!worker) return res.status(404).json({ error: "Worker not found" });
    }

    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.laundryId, laundryId)));

    if (!existing) return res.status(404).json({ error: "Conversation not found" });

    await db
      .update(conversations)
      .set({ assignedWorkerId: parsed.data.workerId, updatedAt: new Date() })
      .where(eq(conversations.id, id));

    return res.json({ ok: true });
  } catch (err) {
    console.error("[conversations] PATCH /:id/assign error:", err);
    return res.status(500).json({ error: "Failed to assign conversation" });
  }
});
