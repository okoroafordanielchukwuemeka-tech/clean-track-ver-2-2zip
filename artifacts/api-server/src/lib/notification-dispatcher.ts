/**
 * Provider-agnostic Notification Dispatcher
 *
 * Responsibilities:
 *  1. Match an internal EventType to a NotificationEventTrigger
 *  2. Look up active templates for that trigger + channel
 *  3. Interpolate {{variable}} placeholders
 *  4. Write notification_events + notification_messages records
 *  5. Log what would be sent (no real provider call yet)
 *
 * To integrate a real provider later, implement the ChannelProvider
 * interface and register it in CHANNEL_PROVIDERS below.
 */

import { db } from "@workspace/db";
import {
  notificationTemplates,
  notificationEvents,
  notificationMessages,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import type { EventType } from "./events.js";
import type {
  NotificationChannel,
  NotificationEventTrigger,
} from "@workspace/db/schema";

// ─── Event → Trigger mapping ────────────────────────────────────────────────

const EVENT_TO_TRIGGER: Partial<Record<EventType, NotificationEventTrigger>> = {
  new_order: "order_received",
  order_ready: "order_ready",
  pickup_completed: "order_delivered",
  unpaid_balance: "payment_reminder",
  overdue: "pickup_reminder",
  due_soon: "pickup_reminder",
};

// ─── Variable interpolation ──────────────────────────────────────────────────

function interpolate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ─── Provider stub ───────────────────────────────────────────────────────────

interface ChannelProvider {
  send(params: {
    phone: string;
    body: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ providerMessageId?: string }>;
}

/**
 * CHANNEL_PROVIDERS: Register real provider implementations here.
 * e.g.  whatsapp: new TwilioWhatsAppProvider(process.env.TWILIO_...)
 */
const CHANNEL_PROVIDERS: Partial<Record<NotificationChannel, ChannelProvider>> =
  {
    // whatsapp: undefined,  ← plug in provider here
    // sms: undefined,
    // email: undefined,
    // push: undefined,
  };

// ─── Dispatch payload ────────────────────────────────────────────────────────

export interface DispatchPayload {
  laundryId: number;
  branchId?: number | null;
  eventType: EventType;
  orderId?: number | null;
  customerId?: number | null;
  customerPhone?: string | null;
  customerName?: string | null;
  /** Variable values used for template interpolation */
  variables?: Record<string, string>;
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

export async function dispatchNotification(
  payload: DispatchPayload
): Promise<void> {
  try {
    const trigger = EVENT_TO_TRIGGER[payload.eventType];

    // No customer-facing trigger for this event — insert a skipped event log
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

    // No phone — cannot dispatch outbound message
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

    // Filter: templates scoped to specific branch take priority; else use global (branchId = null)
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

    // Insert a single notification_event record for this trigger
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

    // Queue one message per applicable template
    let allQueued = true;
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

      // Attempt send via registered provider (if any)
      const provider = CHANNEL_PROVIDERS[tmpl.channel];
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
        } catch (err: unknown) {
          const errorMsg =
            err instanceof Error ? err.message : String(err);
          await db
            .update(notificationMessages)
            .set({
              status: "failed",
              errorMessage: errorMsg,
              failedAt: new Date(),
            })
            .where(eq(notificationMessages.id, msg.id));
          allQueued = false;
          console.error(
            `[NotifDispatcher] Send failed — channel=${tmpl.channel} phone=${payload.customerPhone}:`,
            errorMsg
          );
        }
      } else {
        // No provider registered — message stays "queued" (ready for future provider)
        console.log(
          `[NotifDispatcher] Queued (no provider) — channel=${tmpl.channel} trigger=${trigger} phone=${payload.customerPhone}`
        );
      }
    }

    // Mark event as dispatched
    await db
      .update(notificationEvents)
      .set({ status: allQueued ? "dispatched" : "failed" })
      .where(eq(notificationEvents.id, event.id));
  } catch (err) {
    console.error("[NotifDispatcher] Dispatch error:", err);
  }
}

// ─── Variable builder helpers ─────────────────────────────────────────────────

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
    customer_name: params.customerName,
    order_number: params.orderNumber,
    branch_name: params.branchName,
    business_name: params.businessName,
    service_type: params.serviceType,
    total_due: params.totalDue,
    amount_paid: params.amountPaid,
    balance: params.balance,
  };
}
