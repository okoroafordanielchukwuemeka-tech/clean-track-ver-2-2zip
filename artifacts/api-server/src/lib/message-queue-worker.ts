/**
 * WhatsApp Message Queue Worker
 *
 * Picks up pending/retry messages from the message_queue table and delivers
 * them via the ProviderRegistry. Implements:
 *   - Exponential backoff retries (up to 5 attempts: 1m,2m,4m,8m,16m)
 *   - Per-tenant rate limiting (80 messages/min, tracked via DB count)
 *   - Dead-letter after maxAttempts failures (status="failed")
 *   - Startup recovery: messages stuck in "sending" → reset to "retry"
 *   - On success: writes notification_messages record (if eventId present)
 */

import { db } from "@workspace/db";
import {
  messageQueue,
  notificationMessages,
  notificationEvents,
} from "@workspace/db/schema";
import { eq, and, lte, inArray, or, sql, gte } from "drizzle-orm";
import { providerRegistry } from "./providers/registry.js";
import type { NotificationChannel } from "@workspace/db/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const BATCH_PER_TENANT = 10;
const RATE_LIMIT_PER_MIN = 80;

/** Backoff delays in milliseconds for each attempt (1m, 2m, 4m, 8m, 16m) */
function backoffMs(attempt: number): number {
  return Math.min(Math.pow(2, attempt - 1) * 60_000, 16 * 60_000);
}

// ─── Startup recovery ─────────────────────────────────────────────────────────

/**
 * Reset any messages stuck in "sending" (server crashed mid-send) to "retry"
 * so they are re-attempted on the next worker cycle.
 */
export async function recoverStuckMessages(): Promise<void> {
  try {
    const result = await db
      .update(messageQueue)
      .set({
        status: "retry",
        nextRetryAt: new Date(),
        lastError: "Recovered from crash: was stuck in sending state",
        updatedAt: new Date(),
      })
      .where(eq(messageQueue.status, "sending"))
      .returning({ id: messageQueue.id });

    if (result.length > 0) {
      console.log(`[MessageQueue] Recovered ${result.length} stuck message(s) from sending→retry`);
    }
  } catch (err) {
    console.error("[MessageQueue] Recovery failed:", err);
  }
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

async function countRecentSentForTenant(laundryId: number): Promise<number> {
  const since = new Date(Date.now() - 60_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messageQueue)
    .where(
      and(
        eq(messageQueue.laundryId, laundryId),
        inArray(messageQueue.status, ["sending", "sent"]),
        gte(messageQueue.lastAttemptAt, since)
      )
    );
  return row?.count ?? 0;
}

// ─── In-process mutex (prevents overlapping worker cycles) ────────────────────

let workerRunning = false;

// ─── Core processing ──────────────────────────────────────────────────────────

export async function processMessageQueue(): Promise<void> {
  if (workerRunning) {
    console.debug("[MessageQueue] Previous cycle still running — skipping this tick");
    return;
  }
  workerRunning = true;
  try {
    const now = new Date();

    // Find all distinct laundryIds with actionable messages
    const tenantRows = await db
      .selectDistinct({ laundryId: messageQueue.laundryId })
      .from(messageQueue)
      .where(
        and(
          inArray(messageQueue.status, ["pending", "retry"]),
          or(
            sql`${messageQueue.nextRetryAt} IS NULL`,
            lte(messageQueue.nextRetryAt, now)
          )
        )
      );

    for (const { laundryId } of tenantRows) {
      await processTenantBatch(laundryId, now);
    }
  } catch (err) {
    console.error("[MessageQueue] Worker cycle error:", err);
  } finally {
    workerRunning = false;
  }
}

async function processTenantBatch(laundryId: number, now: Date): Promise<void> {
  try {
    // Rate-limit check
    const sentLastMinute = await countRecentSentForTenant(laundryId);
    if (sentLastMinute >= RATE_LIMIT_PER_MIN) {
      console.log(
        `[MessageQueue] Rate limit reached for laundryId=${laundryId} ` +
        `(${sentLastMinute}/${RATE_LIMIT_PER_MIN} msgs/min). Skipping this cycle.`
      );
      return;
    }

    const remainingCapacity = RATE_LIMIT_PER_MIN - sentLastMinute;
    const limit = Math.min(BATCH_PER_TENANT, remainingCapacity);

    // Atomic claim: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE inside a single
    // transaction so the advisory lock spans both statements, preventing any
    // concurrent worker from claiming the same rows.
    const messages = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(messageQueue)
        .where(
          and(
            eq(messageQueue.laundryId, laundryId),
            inArray(messageQueue.status, ["pending", "retry"]),
            or(
              sql`${messageQueue.nextRetryAt} IS NULL`,
              lte(messageQueue.nextRetryAt, now)
            )
          )
        )
        .orderBy(messageQueue.createdAt)
        .limit(limit)
        .for("update", { skipLocked: true });

      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      await tx
        .update(messageQueue)
        .set({ status: "sending", lastAttemptAt: now, updatedAt: now })
        .where(inArray(messageQueue.id, ids));

      return rows;
    });

    if (messages.length === 0) return;

    // Process each claimed message outside the claim transaction
    for (const msg of messages) {
      await sendMessage(msg, now);
    }
  } catch (err) {
    console.error(`[MessageQueue] Tenant batch error laundryId=${laundryId}:`, err);
  }
}

async function sendMessage(
  msg: typeof messageQueue.$inferSelect,
  attemptTime: Date
): Promise<void> {
  const newAttempts = msg.attempts + 1;

  try {
    const channel = msg.channel as NotificationChannel;
    const provider = await providerRegistry.getProvider(msg.laundryId, channel);

    if (!provider) {
      // No provider configured — move to failed immediately (no point retrying)
      await db
        .update(messageQueue)
        .set({
          status: "failed",
          attempts: newAttempts,
          lastAttemptAt: attemptTime,
          lastError: "No WhatsApp provider configured for this tenant",
          updatedAt: new Date(),
        })
        .where(eq(messageQueue.id, msg.id));
      console.warn(
        `[MessageQueue] No provider for laundryId=${msg.laundryId} — msg ${msg.id} failed permanently`
      );
      return;
    }

    const result = await provider.send({
      phone: msg.recipientPhone,
      body: msg.renderedBody,
    });

    // Success — mark sent
    await db
      .update(messageQueue)
      .set({
        status: "sent",
        attempts: newAttempts,
        lastAttemptAt: attemptTime,
        lastError: null,
        providerMessageId: result.providerMessageId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(messageQueue.id, msg.id));

    // Write notification_messages record on success (if linked to an event)
    if (msg.notificationEventId) {
      try {
        const [nm] = await db
          .insert(notificationMessages)
          .values({
            laundryId: msg.laundryId,
            eventId: msg.notificationEventId,
            channel: msg.channel as any,
            recipientPhone: msg.recipientPhone,
            recipientName: msg.recipientName ?? null,
            renderedBody: msg.renderedBody,
            status: "sent",
            providerMessageId: result.providerMessageId ?? null,
            sentAt: attemptTime,
            metadata: { source: "message_queue", queueId: msg.id },
          })
          .returning();

        // Back-link the notification_message_id onto the queue entry
        await db
          .update(messageQueue)
          .set({ notificationMessageId: nm.id, updatedAt: new Date() })
          .where(eq(messageQueue.id, msg.id));

        // Mark the parent notification event as dispatched
        await db
          .update(notificationEvents)
          .set({ status: "dispatched" })
          .where(
            and(
              eq(notificationEvents.id, msg.notificationEventId),
              eq(notificationEvents.status, "pending")
            )
          );
      } catch (nmErr) {
        console.warn(`[MessageQueue] notification_messages write failed for queue ${msg.id}:`, nmErr);
      }
    }

    console.log(
      `[MessageQueue] Sent — id=${msg.id} wamid=${result.providerMessageId ?? "?"} ` +
      `laundry=${msg.laundryId} attempt=${newAttempts}`
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isFinalAttempt = newAttempts >= MAX_ATTEMPTS;

    if (isFinalAttempt) {
      // Dead-letter: exceeded max attempts
      await db
        .update(messageQueue)
        .set({
          status: "failed",
          attempts: newAttempts,
          lastAttemptAt: attemptTime,
          lastError: errorMsg,
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(eq(messageQueue.id, msg.id));

      // Mark the parent event as failed
      if (msg.notificationEventId) {
        await db
          .update(notificationEvents)
          .set({ status: "failed" })
          .where(
            and(
              eq(notificationEvents.id, msg.notificationEventId),
              eq(notificationEvents.status, "pending")
            )
          );
      }

      console.warn(
        `[MessageQueue] Dead-letter — id=${msg.id} attempts=${newAttempts} ` +
        `laundry=${msg.laundryId} error=${errorMsg}`
      );
    } else {
      // Schedule retry with exponential backoff
      const retryDelay = backoffMs(newAttempts);
      const nextRetryAt = new Date(Date.now() + retryDelay);

      await db
        .update(messageQueue)
        .set({
          status: "retry",
          attempts: newAttempts,
          lastAttemptAt: attemptTime,
          lastError: errorMsg,
          nextRetryAt,
          updatedAt: new Date(),
        })
        .where(eq(messageQueue.id, msg.id));

      console.warn(
        `[MessageQueue] Retry scheduled — id=${msg.id} attempt=${newAttempts}/${MAX_ATTEMPTS} ` +
        `nextRetryAt=${nextRetryAt.toISOString()} error=${errorMsg}`
      );
    }
  }
}

// ─── Startup scheduler ────────────────────────────────────────────────────────

export function startMessageQueueWorker(): void {
  const INTERVAL_MS = 60_000;

  recoverStuckMessages().catch((err) =>
    console.error("[MessageQueue] Startup recovery failed:", err)
  );

  const timer = setInterval(() => {
    processMessageQueue().catch((err) =>
      console.error("[MessageQueue] Worker cycle failed:", err)
    );
  }, INTERVAL_MS);
  timer.unref();

  console.log("[MessageQueue] Worker started (60s interval)");
}
