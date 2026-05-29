import { db } from "@workspace/db";
import { notifications } from "@workspace/db/schema";

export type EventType =
  | "new_order"
  | "order_assigned"
  | "due_soon"
  | "overdue"
  | "payment_received"
  | "unpaid_balance"
  | "order_ready"
  | "partial_pickup"
  | "pickup_completed"
  | "high_expense"
  | "low_profit_warning";

export type Severity = "info" | "warning" | "urgent" | "success";

interface NotificationPayload {
  laundryId: number;
  targetType?: "owner" | "worker" | "all";
  targetWorkerId?: number;
  eventType: EventType;
  title: string;
  message: string;
  severity?: Severity;
  relatedOrderId?: number;
}

export async function emitEvent(payload: NotificationPayload): Promise<void> {
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
    console.error("[EventEngine] Failed to emit event:", err);
  }
}
