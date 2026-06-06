/**
 * Provider Registry
 *
 * Loads per-tenant provider configurations from the database,
 * instantiates the correct ChannelProvider, and caches the result
 * with a short TTL. Invalidate the cache when config is saved.
 */

import { db } from "@workspace/db";
import { providerConfigs } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import type { ChannelProvider } from "./channel-provider.js";
import type { NotificationChannel } from "@workspace/db/schema";
import type { WhatsAppProviderConfig } from "@workspace/db/schema";
import { WhatsAppCloudProvider } from "./whatsapp-cloud.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  provider: ChannelProvider;
  expiresAt: number;
}

class ProviderRegistry {
  private readonly cache = new Map<string, CacheEntry>();

  private key(laundryId: number, channel: string): string {
    return `${laundryId}:${channel}`;
  }

  /**
   * Get a live ChannelProvider for a given laundry + channel.
   * Returns null if no active config exists or the provider isn't
   * implemented yet.
   */
  async getProvider(
    laundryId: number,
    channel: NotificationChannel
  ): Promise<ChannelProvider | null> {
    const k = this.key(laundryId, channel);
    const cached = this.cache.get(k);
    if (cached && cached.expiresAt > Date.now()) return cached.provider;

    const rows = await db
      .select()
      .from(providerConfigs)
      .where(
        and(
          eq(providerConfigs.laundryId, laundryId),
          eq(providerConfigs.provider, channel),
          eq(providerConfigs.isActive, true)
        )
      )
      .limit(1);

    if (!rows.length) return null;

    const cfg = rows[0].config as Record<string, unknown>;
    let provider: ChannelProvider | null = null;

    if (channel === "whatsapp") {
      const { phoneNumberId, accessToken } = cfg as WhatsAppProviderConfig;
      if (phoneNumberId && accessToken) {
        provider = new WhatsAppCloudProvider(cfg as WhatsAppProviderConfig);
      }
    }
    // Future channels: register here
    // else if (channel === "sms") { ... }

    if (provider) {
      this.cache.set(k, {
        provider,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    return provider;
  }

  /**
   * Get the raw provider config rows that contain a given phone_number_id.
   * Used by the webhook router to route inbound status updates to the
   * correct tenant.
   */
  async findByPhoneNumberId(
    phoneNumberId: string
  ): Promise<{ laundryId: number; config: Record<string, unknown> } | null> {
    const rows = await db
      .select()
      .from(providerConfigs)
      .where(
        and(
          eq(providerConfigs.provider, "whatsapp"),
          eq(providerConfigs.isActive, true)
        )
      );

    for (const row of rows) {
      const cfg = row.config as Record<string, unknown>;
      if (cfg.phoneNumberId === phoneNumberId) {
        return { laundryId: row.laundryId, config: cfg };
      }
    }
    return null;
  }

  /** Call after saving or deleting a provider config. */
  invalidate(laundryId: number, channel: string): void {
    this.cache.delete(this.key(laundryId, channel));
  }
}

export const providerRegistry = new ProviderRegistry();
