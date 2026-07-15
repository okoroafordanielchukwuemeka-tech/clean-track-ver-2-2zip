/**
 * WhatsApp Cloud API Webhook Handler
 *
 * GET  /api/webhooks/whatsapp  — Meta webhook verification challenge
 * POST /api/webhooks/whatsapp  — Inbound status updates (sent/delivered/read/failed)
 *
 * These routes are PUBLIC (no requireAuth) because they are called by
 * Meta's servers, not by authenticated users. They respond to Meta within
 * ~200ms and process status updates asynchronously.
 *
 * Security:
 *   GET  — verifies hub.verify_token against per-tenant webhookVerifyToken
 *   POST — verifies X-Hub-Signature-256 HMAC-SHA256 using per-tenant appSecret
 *          (falls back to WHATSAPP_APP_SECRET env var for unidentified tenants)
 *          Requests with missing or invalid signatures are rejected with HTTP 403.
 */

import crypto from "crypto";
import { Router } from "express";
import { db } from "@workspace/db";
import {
  notificationMessages,
  providerConfigs,
  conversations,
  conversationMessages,
  customers,
  notifications,
} from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { WhatsAppCloudProvider, normalizePhoneE164 } from "../lib/providers/whatsapp-cloud.js";
import { webhookEvents } from "@workspace/db/schema";
import { verifyPaystackSignature } from "../lib/paystack.js";
import { activatePlanFromPayment, recordFailedPayment } from "../lib/billing-service.js";

export const webhooksRouter = Router();

// ─── Signature helpers ─────────────────────────────────────────────────────────

/**
 * Compute the expected X-Hub-Signature-256 value for a raw body buffer
 * using the provided secret (Meta App Secret).
 */
function computeSignature(rawBody: Buffer, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  return "sha256=" + hmac.digest("hex");
}

/**
 * Timing-safe comparison of two signature strings.
 * Returns true if they match.
 */
function signaturesMatch(expected: string, received: string): boolean {
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Identify which laundry's phoneNumberId appears in a WhatsApp webhook payload.
 * Returns null if the payload is malformed or no phoneNumberId is present.
 */
function extractPhoneNumberId(payload: unknown): string | null {
  try {
    const entry = (payload as any)?.entry?.[0];
    const change = entry?.changes?.[0];
    return change?.value?.metadata?.phone_number_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Look up the appSecret for the tenant that owns the given phoneNumberId.
 * Returns null if no matching active config is found.
 */
async function lookupAppSecretByPhoneNumberId(
  phoneNumberId: string
): Promise<string | null> {
  try {
    const configs = await db
      .select()
      .from(providerConfigs)
      .where(
        and(
          eq(providerConfigs.provider, "whatsapp"),
          eq(providerConfigs.isActive, true)
        )
      );

    const matched = configs.find((row: { config: unknown }) => {
      const cfg = row.config as Record<string, unknown>;
      return cfg.phoneNumberId === phoneNumberId;
    });

    if (!matched) return null;
    const cfg = (matched as { config: unknown }).config as Record<string, unknown>;
    return (cfg.appSecret as string) || null;
  } catch {
    return null;
  }
}

/**
 * Verify the X-Hub-Signature-256 header on an inbound webhook POST.
 *
 * Strategy (multi-tenant):
 * Fail-closed: any request that cannot be cryptographically verified is
 * rejected with 403. This means:
 *   - Missing X-Hub-Signature-256 header → 403
 *   - No appSecret configured (neither per-tenant nor env fallback) → 403
 *   - Signature present but does not match → 403
 *
 * Secret resolution order:
 *   1. Parse payload to extract phoneNumberId → look up per-tenant appSecret
 *   2. Fall back to WHATSAPP_APP_SECRET env var (single-tenant / bootstrap use)
 *   3. If neither is available → reject (we cannot verify, so we must deny)
 */
async function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  payload: unknown
): Promise<{ reject: boolean; reason: string }> {
  // Missing signature header → always reject (fail-closed)
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    console.warn(
      "[Webhook] Missing or malformed X-Hub-Signature-256 header — rejecting. " +
      "Ensure WHATSAPP_APP_SECRET (or per-tenant App Secret) is configured in Meta Developer settings."
    );
    return { reject: true, reason: "missing_signature" };
  }

  // Resolve the secret to verify against (fail-closed if none found)
  const phoneNumberId = extractPhoneNumberId(payload);
  let secret: string | null = null;

  if (phoneNumberId) {
    secret = await lookupAppSecretByPhoneNumberId(phoneNumberId);
    if (secret) {
      console.debug(
        `[Webhook] Verifying with per-tenant appSecret for phoneNumberId=${phoneNumberId}`
      );
    }
  }

  // Fall back to env var if no per-tenant secret found
  if (!secret) {
    secret = process.env.WHATSAPP_APP_SECRET ?? null;
    if (secret) {
      console.debug("[Webhook] Verifying with WHATSAPP_APP_SECRET env fallback");
    }
  }

  // No secret available → cannot verify → reject (fail-closed)
  if (!secret) {
    console.warn(
      "[Webhook] X-Hub-Signature-256 present but no appSecret configured " +
      `(phoneNumberId=${phoneNumberId ?? "unknown"}) — rejecting. ` +
      "Set WHATSAPP_APP_SECRET env var or configure App Secret in Communication settings."
    );
    return { reject: true, reason: "no_secret_configured" };
  }

  // Verify the signature using timing-safe comparison
  const expected = computeSignature(rawBody, secret);
  if (!signaturesMatch(expected, signatureHeader)) {
    console.warn(
      `[Webhook] X-Hub-Signature-256 mismatch — rejecting (phoneNumberId=${phoneNumberId ?? "unknown"})`
    );
    return { reject: true, reason: "signature_mismatch" };
  }

  return { reject: false, reason: "ok" };
}

// ─── GET /webhooks/whatsapp — challenge verification ───────────────────────────

webhooksRouter.get("/whatsapp", async (req, res) => {
  const mode = req.query["hub.mode"] as string;
  const token = req.query["hub.verify_token"] as string;
  const challenge = req.query["hub.challenge"] as string;

  if (mode !== "subscribe" || !token || !challenge) {
    return res.status(400).json({ error: "Invalid verification request" });
  }

  try {
    // Check all active WhatsApp configs for a matching webhookVerifyToken
    const configs = await db
      .select()
      .from(providerConfigs)
      .where(
        and(
          eq(providerConfigs.provider, "whatsapp"),
          eq(providerConfigs.isActive, true)
        )
      );

    const matched = configs.find((row: { config: unknown }) => {
      const cfg = row.config as Record<string, unknown>;
      return cfg.webhookVerifyToken === token;
    });

    // Also allow a system-level fallback token for easier setup
    const systemToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (matched || (systemToken && token === systemToken)) {
      console.log("[Webhook] WhatsApp challenge verified");
      return res.status(200).send(challenge);
    }

    console.warn("[Webhook] WhatsApp challenge rejected — token mismatch");
    return res.status(403).json({ error: "Forbidden" });
  } catch (err) {
    console.error("[Webhook] Challenge verification error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /webhooks/whatsapp — status updates ──────────────────────────────────

webhooksRouter.post("/whatsapp", async (req, res) => {
  // req.body is a raw Buffer (from express.raw middleware in app.ts)
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  const signatureHeader = req.headers["x-hub-signature-256"] as string | undefined;

  // Parse payload for both signature lookup and processing
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  // ── Signature verification ───────────────────────────────────────────────
  const { reject, reason } = await verifyWebhookSignature(rawBody, signatureHeader, payload);
  if (reject) {
    return res.status(403).end();
  }

  // ── Respond immediately — Meta requires < 20 s response ─────────────────
  res.status(200).json({ status: "ok" });

  // ── Process asynchronously ───────────────────────────────────────────────
  processWhatsAppWebhook(payload).catch((err) =>
    console.error("[Webhook] Processing error:", err)
  );
});

// ─── Helper: look up laundryId by phoneNumberId ────────────────────────────────

async function lookupLaundryByPhoneNumberId(phoneNumberId: string): Promise<number | null> {
  try {
    const configs = await db
      .select({ laundryId: providerConfigs.laundryId, config: providerConfigs.config })
      .from(providerConfigs)
      .where(and(eq(providerConfigs.provider, "whatsapp"), eq(providerConfigs.isActive, true)));

    const matched = configs.find((row) => {
      const cfg = row.config as Record<string, unknown>;
      return cfg.phoneNumberId === phoneNumberId;
    });

    return matched?.laundryId ?? null;
  } catch {
    return null;
  }
}

// ─── Async webhook processing ─────────────────────────────────────────────────

async function processWhatsAppWebhook(payload: unknown): Promise<void> {
  const parser = new WhatsAppCloudProvider({
    phoneNumberId: "",
    accessToken: "",
    businessAccountId: "",
    webhookVerifyToken: "",
  });

  const { statusUpdates, inboundMessages } = parser.handleWebhook(payload);

  // ── 1. Outbound status updates ─────────────────────────────────────────────
  for (const update of statusUpdates) {
    try {
      const rows = await db
        .select({ id: notificationMessages.id, status: notificationMessages.status })
        .from(notificationMessages)
        .where(eq(notificationMessages.providerMessageId, update.providerMessageId))
        .limit(1);

      if (!rows.length) {
        console.warn(`[Webhook] Message not found for providerMessageId=${update.providerMessageId}`);
        continue;
      }

      const msg = rows[0];

      const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
      const currentRank = RANK[msg.status] ?? -1;
      const newRank = RANK[update.status] ?? -1;
      if (update.status !== "failed" && newRank <= currentRank) continue;

      const patch: Record<string, unknown> = { status: update.status };
      if (update.status === "sent")      patch.sentAt = update.timestamp;
      if (update.status === "delivered") patch.deliveredAt = update.timestamp;
      if (update.status === "read")      patch.readAt = update.timestamp;
      if (update.status === "failed") {
        patch.failedAt = update.timestamp;
        patch.errorMessage =
          update.errorMessage ?? (update.errorCode ? `Error code ${update.errorCode}` : "Unknown error");
      }

      await db.update(notificationMessages).set(patch).where(eq(notificationMessages.id, msg.id));
      console.log(`[Webhook] Updated message ${msg.id} → ${update.status}`);
    } catch (err) {
      console.error(`[Webhook] Failed to update message ${update.providerMessageId}:`, err);
    }
  }

  // ── 2. Inbound messages from customers ────────────────────────────────────
  for (const msg of inboundMessages ?? []) {
    try {
      // Resolve which laundry this phoneNumberId belongs to
      const laundryId = await lookupLaundryByPhoneNumberId(msg.phoneNumberId);
      if (!laundryId) {
        console.warn(`[Webhook] No active laundry found for phoneNumberId=${msg.phoneNumberId}`);
        continue;
      }

      // Normalize sender phone to E.164
      const senderPhone = normalizePhoneE164(msg.from);

      // Look up customer by phone + laundryId (soft-delete aware)
      const [customer] = await db
        .select({ id: customers.id, fullName: customers.fullName })
        .from(customers)
        .where(
          and(
            eq(customers.laundryId, laundryId),
            eq(customers.phone, senderPhone),
            isNull(customers.deletedAt)
          )
        )
        .limit(1);

      const now = new Date();

      // ── Find or create conversation thread ─────────────────────────────
      const [existingConv] = await db
        .select({
          id: conversations.id,
          unreadCount: conversations.unreadCount,
          status: conversations.status,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.laundryId, laundryId),
            eq(conversations.customerPhone, senderPhone),
            eq(conversations.channel, "whatsapp")
          )
        )
        .limit(1);

      let conversationId: number;

      if (existingConv) {
        conversationId = existingConv.id;
        await db
          .update(conversations)
          .set({
            lastMessageAt: msg.timestamp,
            unreadCount: existingConv.unreadCount + 1,
            // Reopen if it was resolved when customer writes back
            status: existingConv.status === "resolved" ? "open" : existingConv.status,
            // Refresh customer linkage if it was missing and we now found them
            customerId: customer?.id ?? undefined,
            customerName: customer?.fullName ?? undefined,
            updatedAt: now,
          })
          .where(eq(conversations.id, existingConv.id));
      } else {
        const [newConv] = await db
          .insert(conversations)
          .values({
            laundryId,
            customerId: customer?.id ?? null,
            channel: "whatsapp",
            customerPhone: senderPhone,
            customerName: customer?.fullName ?? null,
            status: "open",
            lastMessageAt: msg.timestamp,
            unreadCount: 1,
          })
          .returning({ id: conversations.id });
        conversationId = newConv.id;
      }

      // ── Save the inbound conversation message ──────────────────────────
      await db.insert(conversationMessages).values({
        conversationId,
        laundryId,
        direction: "inbound",
        body: msg.body,
        providerMessageId: msg.providerMessageId,
        senderType: "customer",
        senderName: customer?.fullName ?? null,
        metadata: { messageType: msg.messageType, from: msg.from },
        createdAt: msg.timestamp,
      });

      // ── Dashboard notification for the owner ───────────────────────────
      const preview = msg.body.length > 80 ? msg.body.substring(0, 80) + "…" : msg.body;
      const senderLabel = customer?.fullName ?? senderPhone;
      await db.insert(notifications).values({
        laundryId,
        targetType: "owner",
        eventType: "whatsapp_message",
        title: "New WhatsApp message",
        message: `${senderLabel}: ${preview}`,
        severity: "info",
        isRead: false,
        relatedConversationId: conversationId,
      });

      console.log(
        `[Webhook] Inbound message saved — laundry=${laundryId} conv=${conversationId} from=${senderPhone} customer=${customer?.id ?? "unknown"}`
      );
    } catch (err) {
      console.error(`[Webhook] Failed to process inbound message from ${msg.from}:`, err);
    }
  }
}

// ─── POST /webhooks/paystack — payment lifecycle events ────────────────────────
//
// Handles: charge.success, charge.failed (and any other Paystack event type —
// unrecognized types are recorded but ignored). Every event is written to
// webhook_events BEFORE processing; the unique (provider, eventKey) constraint
// makes retried/duplicate deliveries no-ops. Signature verification is
// fail-closed: missing/invalid X-Paystack-Signature always returns 403.

webhooksRouter.post("/paystack", async (req, res) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  const signatureHeader = req.headers["x-paystack-signature"] as string | undefined;

  if (!verifyPaystackSignature(rawBody, signatureHeader)) {
    console.warn("[Webhook] Paystack signature missing/invalid — rejecting");
    return res.status(403).end();
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  // Respond immediately — Paystack retries on slow/non-2xx responses.
  res.status(200).json({ status: "ok" });

  const eventType: string = payload?.event ?? "unknown";
  const data = payload?.data ?? {};
  const reference: string | undefined = data?.reference;
  const laundryId = Number(data?.metadata?.laundryId) || null;

  // De-dup key: event type + reference + status (a distinct new event will
  // always have at least one of these differ from the original).
  const eventKey = `${eventType}:${reference ?? "no-ref"}:${data?.status ?? ""}`;

  let webhookEventId: number;
  try {
    const [row] = await db
      .insert(webhookEvents)
      .values({
        provider: "paystack",
        eventType,
        eventKey,
        laundryId,
        reference: reference ?? null,
        status: "received",
        payload,
      })
      .returning({ id: webhookEvents.id });
    webhookEventId = row.id;
  } catch {
    // Unique constraint violation → this exact event was already recorded/processed.
    console.log(`[Webhook] Paystack duplicate event ignored: ${eventKey}`);
    return;
  }

  try {
    await processPaystackWebhook(eventType, data);
    await db.update(webhookEvents).set({ status: "processed", processedAt: new Date() }).where(eq(webhookEvents.id, webhookEventId));
  } catch (err) {
    console.error(`[Webhook] Paystack processing error for ${eventType}:`, err);
    await db
      .update(webhookEvents)
      .set({ status: "failed", processedAt: new Date(), error: err instanceof Error ? err.message : String(err) })
      .where(eq(webhookEvents.id, webhookEventId));
  }
});

async function processPaystackWebhook(eventType: string, data: any): Promise<void> {
  switch (eventType) {
    case "charge.success": {
      // Verify server-side rather than trusting the webhook payload directly —
      // Paystack's own recommendation to guard against forged/replayed bodies.
      const { verifyTransaction } = await import("../lib/paystack.js");
      const verified = await verifyTransaction(data.reference);
      if (verified.status === "success") {
        await activatePlanFromPayment(verified);
      }
      break;
    }
    case "charge.failed": {
      const laundryId = Number(data?.metadata?.laundryId);
      const invoiceId = Number(data?.metadata?.invoiceId);
      if (laundryId) {
        await recordFailedPayment({
          laundryId,
          invoiceId: invoiceId || undefined,
          reference: data.reference,
          reason: data.gateway_response ?? "declined",
        });
      }
      break;
    }
    default:
      console.log(`[Webhook] Paystack event ignored (no handler): ${eventType}`);
  }
}
