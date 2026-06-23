import { pgTable, serial, integer, varchar, jsonb, timestamp, index, unique } from "drizzle-orm/pg-core";
import { laundries } from "./laundries.js";

export const activationEvents = pgTable("activation_events", {
  id: serial("id").primaryKey(),
  laundryId: integer("laundry_id").notNull().references(() => laundries.id, { onDelete: "cascade" }),
  eventName: varchar("event_name", { length: 60 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("activation_events_laundry_event_uniq").on(t.laundryId, t.eventName),
  index("activation_events_laundry_id_idx").on(t.laundryId),
  index("activation_events_event_name_idx").on(t.eventName),
  index("activation_events_created_at_idx").on(t.createdAt),
]);

export type ActivationEvent = typeof activationEvents.$inferSelect;
export type NewActivationEvent = typeof activationEvents.$inferInsert;

export const ACTIVATION_EVENT_SCORES: Record<string, number> = {
  workspace_created: 10,
  branch_created: 15,
  service_created: 15,
  customer_created: 15,
  order_created: 30,
  order_completed: 15,
};

export const ACTIVATION_EVENTS = [
  "workspace_created",
  "branch_created",
  "service_created",
  "customer_created",
  "order_created",
  "payment_recorded",
  "order_completed",
  "worker_created",
  "first_return_login",
  "welcome_email_sent",
  "welcome_email_opened",
  "welcome_email_clicked",
] as const;

export type ActivationEventName = typeof ACTIVATION_EVENTS[number];

export function computeActivationScore(firedEvents: string[]): number {
  const set = new Set(firedEvents);
  return Object.entries(ACTIVATION_EVENT_SCORES).reduce(
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
  return null;
}
