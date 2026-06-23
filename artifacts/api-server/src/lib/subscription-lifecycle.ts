/**
 * Subscription Lifecycle Scheduler
 *
 * Runs daily to automate subscription state transitions:
 *
 *   trial  ──[trialEndsAt < now]──────────────► past_due  (grace starts)
 *   past_due ──[renewsAt < now, 7-day grace]──► suspended
 *
 * Every transition writes a subscription_logs entry.
 * All operations are multi-tenant safe (per-laundry).
 */

import { db } from "@workspace/db";
import { laundries, subscriptionLogs } from "@workspace/db/schema";
import { eq, lt, and } from "drizzle-orm";
import { GRACE_PERIOD_DAYS } from "./entitlements.js";
import type { SubscriptionStatus } from "@workspace/db/schema";

const LOG_PREFIX = "[subscription-lifecycle]";

async function logTransition(
  laundryId: number,
  fromStatus: SubscriptionStatus,
  toStatus: SubscriptionStatus,
  reason: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await db.insert(subscriptionLogs).values({
    laundryId,
    fromStatus,
    toStatus,
    reason,
    changedBy: "system",
    metadata: { ...metadata, scheduledAt: new Date().toISOString() },
  });
}

/**
 * Phase A: Expire trials that have passed their trialEndsAt.
 * Transitions: trial → past_due
 * Sets subscriptionRenewsAt = now + GRACE_PERIOD_DAYS (used as grace deadline).
 */
async function expireTrials(): Promise<number> {
  const now = new Date();

  const expiredTrials = await db
    .select({
      id: laundries.id,
      businessName: laundries.businessName,
      ownerEmail: laundries.ownerEmail,
      trialEndsAt: laundries.trialEndsAt,
    })
    .from(laundries)
    .where(
      and(
        eq(laundries.subscriptionStatus, "trial"),
        lt(laundries.trialEndsAt, now)
      )
    );

  if (expiredTrials.length === 0) return 0;

  const graceDeadline = new Date(now.getTime() + GRACE_PERIOD_DAYS * 86_400_000);
  let count = 0;

  for (const laundry of expiredTrials) {
    try {
      await db
        .update(laundries)
        .set({
          subscriptionStatus: "past_due",
          subscriptionRenewsAt: graceDeadline,
          updatedAt: now,
        })
        .where(eq(laundries.id, laundry.id));

      await logTransition(laundry.id, "trial", "past_due", "trial_expired", {
        trialEndsAt: laundry.trialEndsAt?.toISOString(),
        graceDeadline: graceDeadline.toISOString(),
        businessName: laundry.businessName,
        ownerEmail: laundry.ownerEmail,
      });

      console.log(
        `${LOG_PREFIX} Trial expired → past_due: ${laundry.businessName} (${laundry.ownerEmail})`
      );
      count++;
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to expire trial for laundry ${laundry.id}:`,
        err
      );
    }
  }

  return count;
}

/**
 * Phase B: Suspend past_due accounts whose grace period has ended.
 * Transitions: past_due → suspended
 * Grace deadline is stored in subscriptionRenewsAt (set during trial expiry).
 */
async function suspendExpiredGracePeriods(): Promise<number> {
  const now = new Date();

  const overdue = await db
    .select({
      id: laundries.id,
      businessName: laundries.businessName,
      ownerEmail: laundries.ownerEmail,
      subscriptionRenewsAt: laundries.subscriptionRenewsAt,
    })
    .from(laundries)
    .where(
      and(
        eq(laundries.subscriptionStatus, "past_due"),
        lt(laundries.subscriptionRenewsAt, now)
      )
    );

  if (overdue.length === 0) return 0;

  let count = 0;

  for (const laundry of overdue) {
    try {
      await db
        .update(laundries)
        .set({
          subscriptionStatus: "suspended",
          updatedAt: now,
        })
        .where(eq(laundries.id, laundry.id));

      await logTransition(laundry.id, "past_due", "suspended", "grace_period_expired", {
        graceEndedAt: laundry.subscriptionRenewsAt?.toISOString(),
        businessName: laundry.businessName,
        ownerEmail: laundry.ownerEmail,
      });

      console.log(
        `${LOG_PREFIX} Grace period ended → suspended: ${laundry.businessName} (${laundry.ownerEmail})`
      );
      count++;
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to suspend laundry ${laundry.id}:`,
        err
      );
    }
  }

  return count;
}

/**
 * Run the full lifecycle check once.
 * Safe to call multiple times — all operations are idempotent.
 */
export async function runLifecycleCheck(): Promise<void> {
  try {
    const expired = await expireTrials();
    const suspended = await suspendExpiredGracePeriods();

    if (expired > 0 || suspended > 0) {
      console.log(
        `${LOG_PREFIX} Lifecycle run complete: ${expired} trial(s) expired, ${suspended} account(s) suspended.`
      );
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Lifecycle check failed:`, err);
  }
}

/**
 * Schedule the lifecycle check to run daily at 03:00 UTC
 * (one hour after the backup scheduler to avoid resource contention).
 */
function msUntilNext3amUTC(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startSubscriptionLifecycleScheduler(): void {
  const delayMs = msUntilNext3amUTC();
  const hours = Math.round((delayMs / 3_600_000) * 10) / 10;

  console.log(
    `${LOG_PREFIX} Scheduled. Next run in ${hours}h (03:00 UTC daily).`
  );

  runLifecycleCheck().catch((err) =>
    console.error(`${LOG_PREFIX} Startup check failed:`, err)
  );

  const firstRun = setTimeout(() => {
    runLifecycleCheck().catch((err) =>
      console.error(`${LOG_PREFIX} Scheduled run failed:`, err)
    );

    const interval = setInterval(() => {
      runLifecycleCheck().catch((err) =>
        console.error(`${LOG_PREFIX} Scheduled run failed:`, err)
      );
    }, 24 * 60 * 60 * 1000);

    interval.unref();
  }, delayMs);

  firstRun.unref();
}
