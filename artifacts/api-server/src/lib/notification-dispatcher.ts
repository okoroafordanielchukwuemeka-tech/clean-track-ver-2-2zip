/**
 * Provider-agnostic Notification Dispatcher
 *
 * Responsibilities:
 *  1. Match an internal EventType to a NotificationEventTrigger
 *  2. Look up active templates for that trigger + channel
 *  3. Interpolate {{variable}} placeholders
 *  4. Write notification_events record (status=pending)
 *  5. Enqueue messages to message_queue (durable — worker handles delivery+retries)
 *
 * NOTE: This dispatcher no longer calls the WhatsApp API directly.
 * The message_queue worker (60s interval) picks up queued messages and
 * delivers them with exponential backoff retries (up to 5 attempts).
 */

import { db } from "@workspace/db";
import {
  notificationTemplates,
  notificationEvents,
  messageQueue,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import type { EventType } from "./events.js";
import type { NotificationEventTrigger } from "@workspace/db/schema";

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

    // Enqueue one message_queue entry per template
    // The queue worker handles actual delivery with retries + rate limiting
    for (const tmpl of applicable) {
      const rendered = interpolate(tmpl.body, vars);

      await db.insert(messageQueue).values({
        laundryId: payload.laundryId,
        templateName: tmpl.name,
        recipientPhone: payload.customerPhone,
        recipientName: payload.customerName ?? null,
        variables: vars,
        renderedBody: rendered,
        channel: tmpl.channel,
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        notificationEventId: event.id,
      });

      console.log(
        `[Dispatcher] Enqueued — channel=${tmpl.channel} trigger=${trigger} ` +
        `laundry=${payload.laundryId} eventId=${event.id}`
      );
    }
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
  // ── Payment details (Phase 7.9) — read from businessProfile.paymentDetails,
  // never hardcoded. Omitted fields render as an empty string in templates.
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  paymentReference?: string;
  paymentInstructions?: string;
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
    bank_name:            params.bankName ?? "",
    account_name:         params.accountName ?? "",
    account_number:       params.accountNumber ?? "",
    payment_reference:    params.paymentReference ?? "",
    payment_instructions: params.paymentInstructions ?? "",
  };
}
