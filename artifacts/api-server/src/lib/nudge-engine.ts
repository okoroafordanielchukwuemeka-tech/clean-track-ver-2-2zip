/**
 * Nudge Engine — Customer Success Automation
 *
 * Runs on a schedule to detect stuck workspaces and send
 * personalized nudge emails at 24h, 48h, and 7d thresholds.
 *
 * Rules:
 * - One nudge per (laundry_id, stuck_stage, nudge_type) — deduped via nudge_log unique constraint
 * - Nudges are only sent when SMTP is configured
 * - Activation is detected when the stuck stage resolves
 */

import { db } from "@workspace/db";
import { activationEvents, nudgeLog, laundries } from "@workspace/db/schema";
import { eq, sql, and, isNull } from "drizzle-orm";
import crypto from "crypto";
import { sendNudgeEmail } from "./email-nudge-service.js";
import { trackActivationEvent } from "./activation-tracker.js";

const LOG_PREFIX = "[nudge-engine]";

// ── Stuck stage detection ─────────────────────────────────────────────────────

export type StuckStage =
  | "no_branch"
  | "no_services"
  | "no_customer"
  | "no_order"
  | "no_completion";

export interface StuckWorkspace {
  laundryId: number;
  ownerEmail: string;
  businessName: string;
  stuckStage: StuckStage;
  signedUpAt: Date;
  stuckSinceHours: number;
  firedEvents: string[];
}

/** Compute the stuck stage for a workspace based on its fired activation events */
export function computeStuckStage(firedEvents: string[]): StuckStage | null {
  const has = (e: string) => firedEvents.includes(e);
  if (!has("workspace_created")) return null;
  if (!has("branch_created")) return "no_branch";
  if (!has("service_created")) return "no_services";
  if (!has("customer_created")) return "no_customer";
  if (!has("order_created")) return "no_order";
  if (!has("order_completed")) return "no_completion";
  return null; // fully activated
}

/** Human-readable description of the stuck stage for email personalisation */
export const STUCK_STAGE_COPY: Record<StuckStage, {
  subject: string;
  headline: string;
  body: string;
  action: string;
  path: string;
}> = {
  no_branch: {
    subject: "One step to finish setting up CleanTrack",
    headline: "Your workspace needs a branch",
    body: "You signed up but haven't created a branch yet. A branch represents your laundry location — it's the first step to organizing your operations and assigning workers.",
    action: "Create Your Branch",
    path: "/settings",
  },
  no_services: {
    subject: "Add your services to start taking orders",
    headline: "Your setup is almost complete",
    body: "You have a branch, but you haven't added your laundry services yet. Services are what you charge customers for — shirts, trousers, dry cleaning, and more. Without services, you can't create orders.",
    action: "Add Services",
    path: "/services",
  },
  no_customer: {
    subject: "Add your first customer — it takes 30 seconds",
    headline: "You're ready to add customers",
    body: "Your branch and services are set up. The next step is adding your first customer. CleanTrack tracks their order history, outstanding balance, and pickup status automatically.",
    action: "Add First Customer",
    path: "/customers",
  },
  no_order: {
    subject: "Your workspace is ready. Create your first order.",
    headline: "Everything is set up. Try creating an order.",
    body: "You have a branch, services, and a customer — you're fully set up. Creating your first order takes under a minute. Once you do, CleanTrack starts tracking revenue and balances automatically.",
    action: "Create First Order",
    path: "/orders/new",
  },
  no_completion: {
    subject: "Complete your first order to unlock full reporting",
    headline: "Your first order is waiting to be completed",
    body: "You've created an order but haven't completed it yet. Once you mark an order as completed (after pickup), CleanTrack unlocks revenue tracking, customer history, and financial reports.",
    action: "View My Orders",
    path: "/orders",
  },
};

/** Generate a tracking token for a nudge log entry */
export function generateNudgeTrackingToken(nudgeLogId: number): string {
  const secret = process.env.JWT_SECRET ?? "fallback-secret";
  return crypto
    .createHmac("sha256", secret)
    .update(`nudge-track:${nudgeLogId}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyNudgeTrackingToken(token: string, nudgeLogId: number): boolean {
  const expected = generateNudgeTrackingToken(nudgeLogId);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Nudge threshold helpers ───────────────────────────────────────────────────

const THRESHOLDS = {
  "24h": 24,
  "48h": 48,
  "7d": 24 * 7,
} as const;

// ── Main nudge engine run ─────────────────────────────────────────────────────

export async function runNudgeEngine(): Promise<void> {
  console.log(`${LOG_PREFIX} Starting nudge engine run...`);

  try {
    // Get all laundries with their creation times and owner info
    const allLaundries = await db
      .select({
        id: laundries.id,
        ownerEmail: laundries.ownerEmail,
        businessName: laundries.businessName,
        createdAt: laundries.createdAt,
      })
      .from(laundries);

    if (allLaundries.length === 0) return;

    // Get all activation events
    const allEvents = await db
      .select({
        laundryId: activationEvents.laundryId,
        eventName: activationEvents.eventName,
      })
      .from(activationEvents);

    // Group events by laundry
    const eventsByLaundry: Record<number, string[]> = {};
    for (const e of allEvents) {
      if (!eventsByLaundry[e.laundryId]) eventsByLaundry[e.laundryId] = [];
      eventsByLaundry[e.laundryId].push(e.eventName);
    }

    // Get all existing nudges (for deduplication check)
    const sentNudges = await db
      .select({
        laundryId: nudgeLog.laundryId,
        stuckStage: nudgeLog.stuckStage,
        nudgeType: nudgeLog.nudgeType,
        activatedAfter: nudgeLog.activatedAfter,
      })
      .from(nudgeLog);

    const sentSet = new Set(
      sentNudges.map((n) => `${n.laundryId}:${n.stuckStage}:${n.nudgeType}`)
    );

    const now = Date.now();
    let sent = 0;
    let activatedCount = 0;

    for (const laundry of allLaundries) {
      const firedEvents = eventsByLaundry[laundry.id] ?? [];
      const stuckStage = computeStuckStage(firedEvents);

      // ── Check for activation after nudge ──────────────────────────────
      // If this laundry was nudged and is now no longer stuck (or at a later stage),
      // mark the nudge as activated
      const laundryNudges = sentNudges.filter(
        (n) => n.laundryId === laundry.id && !n.activatedAfter
      );

      for (const nudge of laundryNudges) {
        const isNowPastStage = stageIndex(stuckStage) > stageIndex(nudge.stuckStage as StuckStage | null);
        if (isNowPastStage) {
          // Mark activated_after = true for this nudge
          await db
            .update(nudgeLog)
            .set({ activatedAfter: true })
            .where(
              and(
                eq(nudgeLog.laundryId, laundry.id),
                eq(nudgeLog.stuckStage, nudge.stuckStage),
                eq(nudgeLog.nudgeType, nudge.nudgeType)
              )
            );
          // Fire activation_after_nudge event (once per laundry)
          trackActivationEvent(laundry.id, "activation_after_nudge" as any);
          activatedCount++;
        }
      }

      // ── Send nudges for stuck workspaces ──────────────────────────────
      if (!stuckStage) continue; // Not stuck

      const signedUpAt = laundry.createdAt ? new Date(laundry.createdAt) : null;
      if (!signedUpAt) continue;

      const hoursStuck = (now - signedUpAt.getTime()) / (1000 * 60 * 60);

      for (const [nudgeType, thresholdHours] of Object.entries(THRESHOLDS) as [keyof typeof THRESHOLDS, number][]) {
        if (hoursStuck < thresholdHours) continue;
        const key = `${laundry.id}:${stuckStage}:${nudgeType}`;
        if (sentSet.has(key)) continue; // Already sent

        // Send the nudge
        try {
          const token = crypto.randomBytes(32).toString("hex").slice(0, 32); // placeholder until we get the ID
          const [nudgeEntry] = await db
            .insert(nudgeLog)
            .values({
              laundryId: laundry.id,
              ownerEmail: laundry.ownerEmail,
              businessName: laundry.businessName,
              stuckStage,
              nudgeType,
              trackingToken: token, // temporary; updated after insert gives us the ID
            })
            .onConflictDoNothing()
            .returning();

          if (!nudgeEntry) continue; // Already exists (race condition)

          // Update token to use real nudge ID
          const realToken = generateNudgeTrackingToken(nudgeEntry.id);
          await db
            .update(nudgeLog)
            .set({ trackingToken: realToken })
            .where(eq(nudgeLog.id, nudgeEntry.id));

          const baseUrl = process.env.APP_BASE_URL
            ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:5000");

          await sendNudgeEmail({
            to: laundry.ownerEmail,
            businessName: laundry.businessName,
            stuckStage,
            nudgeType,
            nudgeLogId: nudgeEntry.id,
            trackingToken: realToken,
            baseUrl,
          });

          trackActivationEvent(laundry.id, "nudge_email_sent" as any);
          sentSet.add(key);
          sent++;

          console.log(`${LOG_PREFIX} Sent ${nudgeType} nudge to ${laundry.ownerEmail} (stage: ${stuckStage})`);
        } catch (err: any) {
          console.error(`${LOG_PREFIX} Failed to send nudge to ${laundry.ownerEmail}:`, err?.message);
        }
      }
    }

    console.log(`${LOG_PREFIX} Run complete. Sent: ${sent}, Rescued: ${activatedCount}`);
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Run failed:`, err?.message);
  }
}

/** Returns the index of a stuck stage for comparison (higher = further along) */
function stageIndex(stage: StuckStage | null | string): number {
  const order: (StuckStage | null)[] = [null, "no_branch", "no_services", "no_customer", "no_order", "no_completion"];
  // null (after completion) = fully activated, highest index
  const idx = order.indexOf(stage as StuckStage | null);
  return idx === -1 ? order.length : idx; // "not stuck" = length (highest)
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startNudgeScheduler(): void {
  const INTERVAL_MS = 60 * 60 * 1000; // Run every hour

  // Run once on startup (after 2-minute delay to let DB settle)
  const initialDelay = setTimeout(() => {
    runNudgeEngine().catch((err) =>
      console.error(`${LOG_PREFIX} Startup run failed:`, err?.message)
    );
  }, 2 * 60 * 1000);
  initialDelay.unref();

  const now = new Date();
  const msUntilNextHour = (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000;
  const hours = Math.round(msUntilNextHour / (1000 * 60 * 60) * 10) / 10;
  console.log(`${LOG_PREFIX} Scheduled. Next run in ${hours}h (top of hour).`);

  const timer = setInterval(() => {
    runNudgeEngine().catch((err) =>
      console.error(`${LOG_PREFIX} Scheduled run failed:`, err?.message)
    );
  }, INTERVAL_MS);
  timer.unref();
}
