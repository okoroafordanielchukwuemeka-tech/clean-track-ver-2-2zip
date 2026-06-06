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
 * Security: the GET endpoint verifies the hub.verify_token against the
 * per-tenant webhook_verify_token stored in provider_configs.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { notificationMessages, providerConfigs } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { providerRegistry } from "../lib/providers/registry.js";
import { WhatsAppCloudProvider } from "../lib/providers/whatsapp-cloud.js";

export const webhooksRouter = Router();

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

    const matched = configs.find((row) => {
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

webhooksRouter.post("/whatsapp", (req, res) => {
  // Respond immediately — Meta requires < 20 s response
  res.status(200).json({ status: "ok" });

  // Process asynchronously
  processWhatsAppWebhook(req.body).catch((err) =>
    console.error("[Webhook] Processing error:", err)
  );
});

// ─── Async webhook processing ─────────────────────────────────────────────────

async function processWhatsAppWebhook(payload: unknown): Promise<void> {
  // Use the provider to parse the webhook (handles all format details)
  const dummyProvider = new WhatsAppCloudProvider({
    phoneNumberId: "",
    accessToken: "",
    businessAccountId: "",
    webhookVerifyToken: "",
  });

  const { phoneNumberId, statusUpdates } = dummyProvider.handleWebhook(payload);

  if (!statusUpdates.length) {
    return; // Not a status update payload (could be inbound message — ignore for now)
  }

  // Apply each status update to the corresponding message record
  for (const update of statusUpdates) {
    try {
      const rows = await db
        .select({ id: notificationMessages.id, status: notificationMessages.status })
        .from(notificationMessages)
        .where(eq(notificationMessages.providerMessageId, update.providerMessageId))
        .limit(1);

      if (!rows.length) {
        console.warn(
          `[Webhook] Message not found for providerMessageId=${update.providerMessageId}`
        );
        continue;
      }

      const msg = rows[0];

      // Enforce lifecycle order: queued → sent → delivered → read
      // Don't downgrade status (e.g. ignore "sent" if already "delivered")
      const RANK: Record<string, number> = {
        queued: 0, sent: 1, delivered: 2, read: 3, failed: 4,
      };
      const currentRank = RANK[msg.status] ?? -1;
      const newRank = RANK[update.status] ?? -1;
      if (update.status !== "failed" && newRank <= currentRank) {
        continue; // stale update — skip
      }

      const patch: Record<string, unknown> = { status: update.status };
      if (update.status === "sent")      patch.sentAt = update.timestamp;
      if (update.status === "delivered") patch.deliveredAt = update.timestamp;
      if (update.status === "read")      patch.readAt = update.timestamp;
      if (update.status === "failed") {
        patch.failedAt = update.timestamp;
        patch.errorMessage =
          update.errorMessage ??
          (update.errorCode ? `Error code ${update.errorCode}` : "Unknown error");
      }

      await db
        .update(notificationMessages)
        .set(patch)
        .where(eq(notificationMessages.id, msg.id));

      console.log(
        `[Webhook] Updated message ${msg.id} → ${update.status}`
      );
    } catch (err) {
      console.error(
        `[Webhook] Failed to update message ${update.providerMessageId}:`,
        err
      );
    }
  }
}
