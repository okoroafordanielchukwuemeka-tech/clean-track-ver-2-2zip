/**
 * Activation Tracker
 *
 * Tracks owner onboarding milestone events for funnel analysis.
 * All calls are fire-and-forget — they NEVER throw or block request handlers.
 *
 * Events are stored once per laundry via a unique constraint on
 * (laundry_id, event_name). Duplicate fires are silently ignored.
 */

import { db } from "@workspace/db";
import { activationEvents } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

export type ActivationEventName =
  | "workspace_created"
  | "branch_created"
  | "service_created"
  | "customer_created"
  | "order_created"
  | "payment_recorded"
  | "order_completed"
  | "worker_created"
  | "first_return_login"
  | "welcome_email_sent"
  | "welcome_email_opened"
  | "welcome_email_clicked";

/**
 * Record an activation milestone event for a laundry.
 * Fire-and-forget — safe to call from any route handler without await.
 * Each event type is stored at most once per laundry.
 */
export function trackActivationEvent(
  laundryId: number,
  eventName: ActivationEventName,
  metadata?: Record<string, unknown>
): void {
  db.insert(activationEvents)
    .values({ laundryId, eventName, metadata: metadata ?? {} })
    .onConflictDoNothing()
    .catch((err) => {
      // Never propagate — analytics must not break user flows
      console.error(`[activation-tracker] Failed to record ${eventName} for laundry ${laundryId}:`, err?.message);
    });
}

// ── Scoring constants ────────────────────────────────────────────────────────

export const EVENT_SCORES: Record<string, number> = {
  workspace_created: 10,
  branch_created: 15,
  service_created: 15,
  customer_created: 15,
  order_created: 30,
  order_completed: 15,
};

export const FUNNEL_STEPS: ActivationEventName[] = [
  "workspace_created",
  "branch_created",
  "service_created",
  "customer_created",
  "order_created",
  "payment_recorded",
  "order_completed",
  "worker_created",
  "first_return_login",
];

export function computeScore(firedEvents: string[]): number {
  const set = new Set(firedEvents);
  return Object.entries(EVENT_SCORES).reduce(
    (total, [event, pts]) => total + (set.has(event) ? pts : 0),
    0
  );
}

export function getActivationState(score: number): "new" | "onboarding" | "activated" {
  if (score <= 30) return "new";
  if (score <= 70) return "onboarding";
  return "activated";
}

export function detectStuckStage(firedEvents: string[]): string | null {
  const has = (e: string) => firedEvents.includes(e);
  if (!has("workspace_created")) return null;
  if (!has("branch_created")) return "Signed up but no branch created";
  if (!has("service_created")) return "Branch exists but no services added";
  if (!has("customer_created")) return "Services exist but no customer created";
  if (!has("order_created")) return "Customer exists but no order created";
  if (!has("order_completed")) return "Order created but not yet completed";
  return null; // fully activated
}

/**
 * Get all fired events for a laundry (used by admin APIs).
 */
export async function getLaundryActivationEvents(laundryId: number): Promise<string[]> {
  const rows = await db
    .select({ eventName: activationEvents.eventName })
    .from(activationEvents)
    .where(eq(activationEvents.laundryId, laundryId));
  return rows.map((r) => r.eventName);
}
