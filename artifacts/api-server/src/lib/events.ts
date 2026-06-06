import { db } from "@workspace/db";
import { notifications } from "@workspace/db/schema";
import { dispatchNotification, buildOrderVariables } from "./notification-dispatcher.js";

export type EventType =
  | "new_order"
  | "order_assigned"
  | "order_processing"
  | "due_soon"
  | "overdue"
  | "payment_received"
  | "unpaid_balance"
  | "order_ready"
  | "partial_pickup"
  | "pickup_completed"
  | "high_expense"
  | "low_profit_warning"
  | "discount_requested"
  | "discount_approved"
  | "discount_rejected";

export type Severity = "info" | "warning" | "urgent" | "success";

interface NotificationPayload {
  laundryId: number;
  branchId?: number | null;
  targetType?: "owner" | "worker" | "all";
  targetWorkerId?: number;
  eventType: EventType;
  title: string;
  message: string;
  severity?: Severity;
  relatedOrderId?: number;
  /** Customer context — used for outbound notification dispatch */
  customer?: {
    id?: number | null;
    phone?: string | null;
    name?: string | null;
  };
  /** Template variable values for outbound message interpolation */
  variables?: Record<string, string>;
}

export async function emitEvent(payload: NotificationPayload): Promise<void> {
  // 1. Write internal notification (in-app bell)
  try {
    await db.insert(notifications).values({
      laundryId: payload.laundryId,
      targetType: payload.targetType ?? "owner",
      targetWorkerId: payload.targetWorkerId,
      eventType: payload.eventType,
      title: payload.title,
      message: payload.message,
      severity: payload.severity ?? "info",
      relatedOrderId: payload.relatedOrderId,
    });
  } catch (err) {
    console.error("[EventEngine] Failed to emit internal notification:", err);
  }

  // 2. Dispatch outbound customer notification (async, non-blocking)
  dispatchNotification({
    laundryId: payload.laundryId,
    branchId: payload.branchId ?? null,
    eventType: payload.eventType,
    orderId: payload.relatedOrderId ?? null,
    customerId: payload.customer?.id ?? null,
    customerPhone: payload.customer?.phone ?? null,
    customerName: payload.customer?.name ?? null,
    variables: payload.variables,
  }).catch((err) =>
    console.error("[NotifDispatcher] Async dispatch error:", err)
  );
}

export { buildOrderVariables };
