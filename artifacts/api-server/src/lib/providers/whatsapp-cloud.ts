/**
 * Meta WhatsApp Cloud API Provider
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Sends text messages via the Graph API and parses delivery webhooks.
 * All secrets come from the per-tenant providerConfigs record — never
 * from process.env.
 */

import type {
  ChannelProvider,
  InboundMessage,
  SendParams,
  SendResult,
  ValidationResult,
  WebhookHandleResult,
  WebhookStatusUpdate,
} from "./channel-provider.js";
import { ProviderError } from "./channel-provider.js";
import type { WhatsAppProviderConfig } from "@workspace/db/schema";

const DEFAULT_API_VERSION = "v21.0";

// ─── Phone normalisation (→ E.164) ────────────────────────────────────────────

/**
 * Convert a local or international phone number to E.164 format.
 * Default country code: Nigeria (+234).
 */
export function normalizePhoneE164(
  phone: string,
  defaultCountryCode = "234"
): string {
  const cleaned = phone.replace(/[\s\-().]/g, "");

  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return "+" + cleaned.slice(2);
  if (cleaned.startsWith("0")) return "+" + defaultCountryCode + cleaned.slice(1);
  if (cleaned.startsWith(defaultCountryCode)) return "+" + cleaned;
  return "+" + defaultCountryCode + cleaned;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class WhatsAppCloudProvider implements ChannelProvider {
  private readonly config: WhatsAppProviderConfig;
  private readonly baseUrl: string;

  constructor(config: WhatsAppProviderConfig) {
    this.config = config;
    const version = config.apiVersion ?? DEFAULT_API_VERSION;
    this.baseUrl = `https://graph.facebook.com/${version}`;
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  async send(params: SendParams): Promise<SendResult> {
    const phone = normalizePhoneE164(params.phone);
    const url = `${this.baseUrl}/${this.config.phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "text",
        text: { preview_url: false, body: params.body },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const err = (data as any)?.error;
      throw new ProviderError(
        err?.message ?? `WhatsApp API error (HTTP ${response.status})`,
        err?.code,
        data
      );
    }

    const messages = (data as any)?.messages as { id: string }[] | undefined;
    const providerMessageId = messages?.[0]?.id;
    return { providerMessageId };
  }

  // ─── Validate ─────────────────────────────────────────────────────────────

  async validateConfiguration(): Promise<ValidationResult> {
    const url =
      `${this.baseUrl}/${this.config.phoneNumberId}` +
      `?fields=display_phone_number,verified_name,quality_rating`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
      });

      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        const err = (data as any)?.error;
        return {
          valid: false,
          error: err?.message ?? `Validation failed (HTTP ${response.status})`,
        };
      }

      return {
        valid: true,
        metadata: {
          displayPhoneNumber: (data as any).display_phone_number,
          verifiedName: (data as any).verified_name,
          qualityRating: (data as any).quality_rating,
        },
      };
    } catch (err: unknown) {
      return {
        valid: false,
        error:
          err instanceof Error
            ? err.message
            : "Network error during validation",
      };
    }
  }

  // ─── Webhook ──────────────────────────────────────────────────────────────

  handleWebhook(payload: unknown): WebhookHandleResult {
    const statusUpdates: WebhookStatusUpdate[] = [];
    const inboundMessages: InboundMessage[] = [];
    let lastPhoneNumberId = "";

    try {
      const entries = (payload as any)?.entry ?? [];

      for (const entry of entries) {
        for (const change of entry?.changes ?? []) {
          const value = change?.value;
          if (!value || change.field !== "messages") continue;

          const phoneNumberId: string = value?.metadata?.phone_number_id ?? "";
          if (phoneNumberId) lastPhoneNumberId = phoneNumberId;

          // ── Outbound status updates ────────────────────────────────────
          for (const raw of value?.statuses ?? []) {
            const wamid: string = raw.id;
            const rawStatus: string = raw.status;
            const ts = new Date(parseInt(raw.timestamp, 10) * 1000);

            if (!wamid || !rawStatus) continue;

            const validStatuses = ["sent", "delivered", "read", "failed"] as const;
            type ValidStatus = (typeof validStatuses)[number];
            if (!validStatuses.includes(rawStatus as ValidStatus)) continue;

            const update: WebhookStatusUpdate = {
              providerMessageId: wamid,
              status: rawStatus as ValidStatus,
              timestamp: ts,
              recipientId: raw.recipient_id,
            };

            if (rawStatus === "failed" && raw.errors?.length) {
              const e = raw.errors[0];
              update.errorCode = e.code;
              update.errorMessage =
                e.error_data?.details ?? e.title ?? e.message ?? "Unknown error";
            }

            statusUpdates.push(update);
          }

          // ── Inbound messages (customer replies) ────────────────────────
          for (const raw of value?.messages ?? []) {
            const wamid: string = raw.id;
            const from: string = raw.from;
            if (!wamid || !from) continue;

            const ts = new Date(parseInt(raw.timestamp, 10) * 1000);
            const rawType: string = raw.type ?? "unknown";

            const KNOWN_TYPES = [
              "text", "image", "audio", "document", "video",
              "sticker", "location",
            ] as const;
            type KnownType = (typeof KNOWN_TYPES)[number];

            const messageType: InboundMessage["messageType"] =
              (KNOWN_TYPES as readonly string[]).includes(rawType)
                ? (rawType as KnownType)
                : "unknown";

            let body: string;
            switch (raw.type) {
              case "text":
                body = raw.text?.body ?? "";
                break;
              case "image":
                body = raw.image?.caption ? `[Image: ${raw.image.caption}]` : "[Image]";
                break;
              case "audio":
                body = "[Voice message]";
                break;
              case "document":
                body = raw.document?.filename
                  ? `[Document: ${raw.document.filename}]`
                  : "[Document]";
                break;
              case "video":
                body = raw.video?.caption ? `[Video: ${raw.video.caption}]` : "[Video]";
                break;
              case "sticker":
                body = "[Sticker]";
                break;
              case "location":
                body = "[Location shared]";
                break;
              default:
                body = `[${raw.type ?? "Unknown"} message]`;
            }

            inboundMessages.push({
              phoneNumberId,
              providerMessageId: wamid,
              from: from.startsWith("+") ? from : `+${from}`,
              body,
              timestamp: ts,
              messageType,
            });
          }
        }
      }
    } catch (err) {
      console.error("[WhatsApp] Webhook parse error:", err);
    }

    if (statusUpdates.length > 0 || inboundMessages.length > 0) {
      return {
        phoneNumberId: lastPhoneNumberId || undefined,
        statusUpdates,
        inboundMessages: inboundMessages.length > 0 ? inboundMessages : undefined,
      };
    }

    return { statusUpdates: [] };
  }
}
