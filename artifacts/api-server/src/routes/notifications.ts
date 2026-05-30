import { Router } from "express";
import { db } from "@workspace/db";
import { notifications, orders, laundries } from "@workspace/db/schema";
import { eq, and, desc, or } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { emitEvent } from "../lib/events.js";

export const notificationsRouter = Router();

const DEFAULT_TURNAROUND: Record<string, number> = {
  express: 24,
  premium: 48,
  standard: 72,
};

async function detectOperationalAlerts(laundryId: number) {
  try {
    const now = new Date();

    const [laundry] = await db
      .select()
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    if (!laundry) return;

    const automation = (laundry.automationSettings ?? {}) as {
      overdueAlerts?: boolean;
      dueSoonAlerts?: boolean;
    };

    const slaHours: Record<string, number> = {
      express: laundry.expressTurnaroundHours ?? DEFAULT_TURNAROUND.express,
      premium: laundry.premiumTurnaroundHours ?? DEFAULT_TURNAROUND.premium,
      standard: laundry.standardTurnaroundHours ?? DEFAULT_TURNAROUND.standard,
    };

    const allActive = await db
      .select()
      .from(orders)
      .where(and(eq(orders.laundryId, laundryId)));

    const activeOrders = allActive.filter(
      (o) => !["completed"].includes(o.status)
    );

    for (const order of activeOrders) {
      const dueAt = order.processingDueAt
        ? new Date(order.processingDueAt)
        : new Date(new Date(order.createdAt).getTime() + (slaHours[order.serviceType] ?? 72) * 3600000);

      const msRemaining = dueAt.getTime() - now.getTime();
      const hoursRemaining = msRemaining / 3600000;
      const expectedHours = slaHours[order.serviceType] ?? 72;
      const isOverdue = hoursRemaining < 0;
      const isDueSoon = !isOverdue && hoursRemaining <= expectedHours * 0.25;

      if (isOverdue && automation.overdueAlerts !== false) {
        const existing = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.laundryId, laundryId),
              eq(notifications.eventType, "overdue"),
              eq(notifications.relatedOrderId, order.id)
            )
          );
        if (existing.length === 0) {
          const hoursOverdue = Math.floor(Math.abs(hoursRemaining));
          await emitEvent({
            laundryId,
            eventType: "overdue",
            title: "Order Overdue",
            message: `Order #${order.orderId} for ${order.customerName} is overdue by ${hoursOverdue}h — SLA was ${expectedHours}h.`,
            severity: "urgent",
            relatedOrderId: order.id,
          });
        }
      } else if (isDueSoon && automation.dueSoonAlerts !== false) {
        const existing = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.laundryId, laundryId),
              eq(notifications.eventType, "due_soon"),
              eq(notifications.relatedOrderId, order.id)
            )
          );
        if (existing.length === 0) {
          const hoursLeft = Math.round(hoursRemaining);
          await emitEvent({
            laundryId,
            eventType: "due_soon",
            title: "Order Due Soon",
            message: `Order #${order.orderId} for ${order.customerName} is due in ~${hoursLeft}h (${order.serviceType} SLA: ${expectedHours}h).`,
            severity: "warning",
            relatedOrderId: order.id,
          });
        }
      }
    }
  } catch (err) {
    console.error("[Alerts] Detection failed:", err);
  }
}

notificationsRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const auth = req.auth!;
    const { laundryId, type, workerId } = auth;

    detectOperationalAlerts(laundryId).catch(() => {});

    const baseConditions: any[] = [eq(notifications.laundryId, laundryId)];

    if (type === "worker") {
      baseConditions.push(
        or(
          and(eq(notifications.targetType, "worker"), workerId ? eq(notifications.targetWorkerId, workerId) : undefined),
          eq(notifications.targetType, "all")
        )
      );
    }

    if (req.query.unread === "true") {
      baseConditions.push(eq(notifications.isRead, false));
    }

    const result = await db
      .select()
      .from(notifications)
      .where(and(...baseConditions))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

notificationsRouter.get("/count", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const unread = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.laundryId, laundryId), eq(notifications.isRead, false)));
    res.json({ count: unread.length });
  } catch {
    res.status(500).json({ error: "Failed to get count" });
  }
});

notificationsRouter.patch("/read-all", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.laundryId, laundryId));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});

notificationsRouter.patch("/:id/read", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.laundryId, laundryId)));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

notificationsRouter.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const id = parseInt(req.params.id);
    await db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.laundryId, laundryId)));
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete notification" });
  }
});
