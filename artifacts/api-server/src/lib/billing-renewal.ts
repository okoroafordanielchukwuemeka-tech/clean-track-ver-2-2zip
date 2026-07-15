/**
 * Renewal Billing Scheduler — Phase 7.8
 *
 * Additive to (and independent of) the existing trial/grace-period scheduler
 * in subscription-lifecycle.ts, which is left untouched. This scheduler only
 * looks at `payment_subscriptions` rows with a saved card authorization and
 * auto-charges them when nextChargeAt is due, driving CleanTrack's own
 * dunning sequence (chargeRenewal → recordFailedPayment escalates the
 * existing past_due grace period; billing-service already sends the
 * payment_successful / payment_failed lifecycle emails).
 */
import { db } from "@workspace/db";
import { paymentSubscriptions, laundries } from "@workspace/db/schema";
import { and, lte, eq, ne } from "drizzle-orm";
import { chargeRenewal } from "./billing-service.js";
import { isPaystackConfigured } from "./paystack.js";
import { log, logError } from "./logger.js";

const LOG_PREFIX = "[billing-renewal]";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

async function runRenewalCheck(): Promise<void> {
  if (!isPaystackConfigured()) return;

  const now = new Date();

  const due = await db
    .select()
    .from(paymentSubscriptions)
    .where(
      and(
        lte(paymentSubscriptions.nextChargeAt, now),
        ne(paymentSubscriptions.status, "cancelled"),
        ne(paymentSubscriptions.status, "non_renewing")
      )
    );

  if (due.length === 0) return;

  let charged = 0;
  for (const sub of due) {
    try {
      // Skip if the tenant already cancelled/downgraded outside this flow.
      const [laundry] = await db
        .select({ subscriptionStatus: laundries.subscriptionStatus })
        .from(laundries)
        .where(eq(laundries.id, sub.laundryId));
      if (!laundry || laundry.subscriptionStatus === "cancelled" || laundry.subscriptionStatus === "suspended") {
        continue;
      }

      await chargeRenewal(sub);
      charged++;
    } catch (err) {
      logError(`${LOG_PREFIX} Renewal check failed for laundry ${sub.laundryId}`, err);
    }
  }

  if (charged > 0) {
    log(`${LOG_PREFIX} Processed ${charged} renewal charge(s)`);
  }
}

export function startRenewalBillingScheduler(): void {
  if (!isPaystackConfigured()) {
    log(`${LOG_PREFIX} Paystack not configured — renewal billing scheduler disabled.`);
    return;
  }

  log(`${LOG_PREFIX} Scheduled — checking hourly for due renewals.`);

  runRenewalCheck().catch((err) => logError(`${LOG_PREFIX} Startup check failed`, err));

  const timer = setInterval(() => {
    runRenewalCheck().catch((err) => logError(`${LOG_PREFIX} Scheduled check failed`, err));
  }, CHECK_INTERVAL_MS);
  timer.unref();
}
