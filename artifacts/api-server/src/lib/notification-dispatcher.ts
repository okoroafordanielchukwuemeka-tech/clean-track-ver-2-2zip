/**
 * Provider-agnostic Notification Dispatcher
 *
 * Responsibilities:
 *  1. Match an internal EventType to a NotificationEventTrigger
 *  2. Look up active templates for that trigger + channel
 *  3. Interpolate {{variable}} placeholders
 *  4. Write notification_events + notification_messages records
 *  5. Route through ProviderRegistry to send (or queue if no provider)
 */

import { db } from "@workspace/db";
import {
  notificationTemplates,
  notificationEvents,
  notificationMessages,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import type { EventType } from "./events.js";
import type { NotificationChannel, NotificationEventTrigger } from "@workspace/db/schema";
import { providerRegistry } from "./providers/registry.js";

// ─── Event → Trigger mapping ──────────────────────────────────────────────────

const EVENT_TO_TRIGGER: Partial<Record<EventType, NotificationEventTrigger>> = {
  new_order:        "order_received",
  order_ready:      "order_ready",
  pickup_completed: "order_delivered",
  unpaid_balance:   "payment_reminder",
  overdue:          "pickup_reminder",
  due_soon:         "pickup_reminder",
};

// ─── Variable interpolation ───────────────────────────────────────────────────

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ─── Dispatch payload ─────────────────────────────────────────────────────────

export interface DispatchPayload {
  laundryId: number;
  branchId?: number | null;
  eventType: EventType;
  orderId?: number | null;
  customerId?: number | null;
  customerPhone?: string | null;
  customerName?: string | null;
  variables?: Record<string, string>;
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function dispatchNotification(payload: DispatchPayload): Promise<void> {
  try {
    const trigger = EVENT_TO_TRIGGER[payload.eventType];

    if (!trigger) {
      await db.insert(notificationEvents).values({
        laundryId: payload.laundryId,
        branchId: payload.branchId ?? null,
        eventType: payload.eventType,
        orderId: payload.orderId ?? null,
        customerId: payload.customerId ?? null,
        customerPhone: payload.customerPhone ?? null,
        customerName: payload.customerName ?? null,
        status: "skipped",
        skipReason: "No customer-facing trigger mapped for this event type",
        metadata: {},
      });
      return;
    }

    if (!payload.customerPhone) {
      await db.insert(notificationEvents).values({
        laundryId: payload.laundryId,
        branchId: payload.branchId ?? null,
        eventType: payload.eventType,
        orderId: payload.orderId ?? null,
        customerId: payload.customerId ?? null,
        customerPhone: null,
        customerName: payload.customerName ?? null,
        status: "skipped",
        skipReason: "No customer phone number available",
        metadata: {},
      });
      return;
    }

    // Find active templates for this trigger + laundry (branch-aware)
    const templates = await db
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.laundryId, payload.laundryId),
          eq(notificationTemplates.eventTrigger, trigger),
          eq(notificationTemplates.isActive, true)
        )
      );

    const applicable = templates.filter(
      (t) =>
        t.branchId == null ||
        (payload.branchId != null && t.branchId === payload.branchId)
    );

    if (applicable.length === 0) {
      await db.insert(notificationEvents).values({
        laundryId: payload.laundryId,
        branchId: payload.branchId ?? null,
        eventType: payload.eventType,
        orderId: payload.orderId ?? null,
        customerId: payload.customerId ?? null,
        customerPhone: payload.customerPhone,
        customerName: payload.customerName ?? null,
        status: "skipped",
        skipReason: `No active templates for trigger: ${trigger}`,
        metadata: { trigger },
      });
      return;
    }

    const [event] = await db
      .insert(notificationEvents)
      .values({
        laundryId: payload.laundryId,
        branchId: payload.branchId ?? null,
        eventType: payload.eventType,
        orderId: payload.orderId ?? null,
        customerId: payload.customerId ?? null,
        customerPhone: payload.customerPhone,
        customerName: payload.customerName ?? null,
        status: "pending",
        metadata: { trigger, templateCount: applicable.length },
      })
      .returning();

    const vars = payload.variables ?? {};
    let anyFailed = false;

    for (const tmpl of applicable) {
      const rendered = interpolate(tmpl.body, vars);

      const [msg] = await db
        .insert(notificationMessages)
        .values({
          laundryId: payload.laundryId,
          eventId: event.id,
          templateId: tmpl.id,
          channel: tmpl.channel,
          recipientPhone: payload.customerPhone,
          recipientName: payload.customerName ?? null,
          renderedBody: rendered,
          status: "queued",
          metadata: { trigger, eventType: payload.eventType },
        })
        .returning();

      // ── Attempt send via ProviderRegistry ────────────────────────────────
      const provider = await providerRegistry.getProvider(
        payload.laundryId,
        tmpl.channel as NotificationChannel
      );

      if (provider) {
        try {
          const result = await provider.send({
            phone: payload.customerPhone,
            body: rendered,
          });
          await db
            .update(notificationMessages)
            .set({
              status: "sent",
              providerMessageId: result.providerMessageId ?? null,
              sentAt: new Date(),
            })
            .where(eq(notificationMessages.id, msg.id));

          console.log(
            `[Dispatcher] Sent — channel=${tmpl.channel} wamid=${result.providerMessageId}`
          );
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await db
            .update(notificationMessages)
            .set({ status: "failed", errorMessage: errorMsg, failedAt: new Date() })
            .where(eq(notificationMessages.id, msg.id));
          anyFailed = true;
          console.error(`[Dispatcher] Send failed — channel=${tmpl.channel}:`, errorMsg);
        }
      } else {
        console.log(
          `[Dispatcher] Queued (no provider) — channel=${tmpl.channel} trigger=${trigger}`
        );
      }
    }

    await db
      .update(notificationEvents)
      .set({ status: anyFailed ? "failed" : "dispatched" })
      .where(eq(notificationEvents.id, event.id));
  } catch (err) {
    console.error("[Dispatcher] Unhandled error:", err);
  }
}

// ─── Variable builder helper ──────────────────────────────────────────────────

export function buildOrderVariables(params: {
  customerName: string;
  orderNumber: string;
  branchName: string;
  businessName: string;
  serviceType: string;
  totalDue: string;
  amountPaid: string;
  balance: string;
}): Record<string, string> {
  return {
    customer_name:  params.customerName,
    order_number:   params.orderNumber,
    branch_name:    params.branchName,
    business_name:  params.businessName,
    service_type:   params.serviceType,
    total_due:      params.totalDue,
    amount_paid:    params.amountPaid,
    balance:        params.balance,
  };
}
