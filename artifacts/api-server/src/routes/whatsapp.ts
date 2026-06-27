import { Router } from "express";
import { db } from "@workspace/db";
import { whatsappConnections, providerConfigs } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { logAction } from "../lib/audit.js";
import { trackActivationEvent } from "../lib/activation-tracker.js";

export const whatsappRouter = Router();

// ── Token encryption helpers ───────────────────────────────────────────────
// AES-256-GCM using a 32-byte key derived from BACKUP_SECRET via SHA-256.
// Format stored: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"

function deriveKey(): Buffer {
  const secret = process.env.BACKUP_SECRET;
  if (!secret) throw new Error("BACKUP_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptToken(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptToken(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error("Invalid encrypted token format");
  const key = deriveKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ── Shared connection save logic ───────────────────────────────────────────
// Used by both the manual /connect endpoint and the OAuth /meta/callback.

interface ConnectionData {
  whatsappBusinessAccountId: string;
  phoneNumberId: string;
  accessToken: string;
  displayPhoneNumber?: string | null;
  businessName?: string | null;
}

async function saveConnection(laundryId: number, data: ConnectionData): Promise<{ connectedAt: Date }> {
  const { whatsappBusinessAccountId, phoneNumberId, accessToken, displayPhoneNumber, businessName } = data;
  const encryptedAccessToken = encryptToken(accessToken);
  const now = new Date();

  await db.transaction(async (tx) => {
    // Upsert whatsapp_connections (one row per laundry)
    const [existing] = await tx
      .select({ id: whatsappConnections.id })
      .from(whatsappConnections)
      .where(eq(whatsappConnections.laundryId, laundryId));

    if (existing) {
      await tx
        .update(whatsappConnections)
        .set({
          whatsappBusinessAccountId,
          phoneNumberId,
          encryptedAccessToken,
          displayPhoneNumber: displayPhoneNumber ?? null,
          businessName: businessName ?? null,
          status: "connected",
          connectedAt: now,
          disconnectedAt: null,
          updatedAt: now,
        })
        .where(eq(whatsappConnections.laundryId, laundryId));
    } else {
      await tx.insert(whatsappConnections).values({
        laundryId,
        whatsappBusinessAccountId,
        phoneNumberId,
        encryptedAccessToken,
        displayPhoneNumber: displayPhoneNumber ?? null,
        businessName: businessName ?? null,
        status: "connected",
        connectedAt: now,
      });
    }

    // Sync to provider_configs so the existing message pipeline can send messages
    const providerConfig = {
      phoneNumberId,
      accessToken,
      businessAccountId: whatsappBusinessAccountId,
      webhookVerifyToken: crypto.randomUUID(),
      displayPhoneNumber: displayPhoneNumber ?? undefined,
      verifiedName: businessName ?? undefined,
    };

    const [existingProvider] = await tx
      .select({ id: providerConfigs.id })
      .from(providerConfigs)
      .where(
        and(
          eq(providerConfigs.laundryId, laundryId),
          eq(providerConfigs.provider, "whatsapp")
        )
      );

    if (existingProvider) {
      await tx
        .update(providerConfigs)
        .set({
          config: providerConfig as any,
          isActive: true,
          isVerified: false,
          updatedAt: now,
        })
        .where(
          and(
            eq(providerConfigs.laundryId, laundryId),
            eq(providerConfigs.provider, "whatsapp")
          )
        );
    } else {
      await tx.insert(providerConfigs).values({
        laundryId,
        provider: "whatsapp",
        config: providerConfig as any,
        isActive: true,
        isVerified: false,
      });
    }
  });

  return { connectedAt: now };
}

// ── Validation schemas ─────────────────────────────────────────────────────

const connectSchema = z.object({
  whatsappBusinessAccountId: z.string().min(1, "Business Account ID is required"),
  phoneNumberId: z.string().min(1, "Phone Number ID is required"),
  accessToken: z.string().min(10, "Access token is required"),
  displayPhoneNumber: z.string().optional(),
  businessName: z.string().optional(),
});

// ── GET /api/whatsapp/status ───────────────────────────────────────────────
// Returns the current WhatsApp connection for this laundry.
// Owners only — workers cannot view WhatsApp configuration.

whatsappRouter.get("/status", requireOwner, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;

  try {
    const [row] = await db
      .select({
        id: whatsappConnections.id,
        whatsappBusinessAccountId: whatsappConnections.whatsappBusinessAccountId,
        phoneNumberId: whatsappConnections.phoneNumberId,
        displayPhoneNumber: whatsappConnections.displayPhoneNumber,
        businessName: whatsappConnections.businessName,
        status: whatsappConnections.status,
        connectedAt: whatsappConnections.connectedAt,
        disconnectedAt: whatsappConnections.disconnectedAt,
      })
      .from(whatsappConnections)
      .where(eq(whatsappConnections.laundryId, laundryId));

    if (!row || row.status === "disconnected") {
      return res.json({ connected: false });
    }

    return res.json({
      connected: true,
      phoneNumberId: row.phoneNumberId,
      whatsappBusinessAccountId: row.whatsappBusinessAccountId,
      displayPhoneNumber: row.displayPhoneNumber ?? null,
      businessName: row.businessName ?? null,
      connectedAt: row.connectedAt,
    });
  } catch (err) {
    console.error("[whatsapp] GET /status error:", err);
    return res.status(500).json({ error: "Failed to fetch WhatsApp status" });
  }
});

// ── GET /api/whatsapp/meta/config ──────────────────────────────────────────
// Returns the Meta app configuration needed by the frontend to launch the
// Embedded Signup popup. Never exposes the app secret.

whatsappRouter.get("/meta/config", requireOwner, async (_req: AuthRequest, res) => {
  const appId = process.env.META_APP_ID;
  const configId = process.env.META_CONFIG_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !configId || !appSecret) {
    return res.json({ available: false });
  }

  return res.json({
    available: true,
    appId,
    configId,
  });
});

// ── POST /api/whatsapp/meta/callback ──────────────────────────────────────
// Receives the OAuth code from the Meta Embedded Signup popup.
// Exchanges it for a long-lived token server-side, fetches the WABA and phone
// number details from the Graph API, then saves the connection.
// The access token is NEVER sent to or from the frontend.

const callbackSchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
  wabaId: z.string().min(1, "WABA ID is required"),
  phoneNumberId: z.string().min(1, "Phone Number ID is required"),
});

whatsappRouter.post("/meta/callback", requireOwner, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;

  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid callback data",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    return res.status(503).json({ error: "Meta Embedded Signup is not configured on this server" });
  }

  const { code, wabaId, phoneNumberId } = parsed.data;

  try {
    // Step 1: Exchange the authorization code for a short-lived token
    const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("code", code);

    const tokenRes = await fetch(tokenUrl.toString());
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("[whatsapp] Token exchange failed:", body);
      return res.status(502).json({ error: "Failed to exchange authorization code with Meta" });
    }
    const tokenData = await tokenRes.json() as { access_token: string; token_type: string };
    const shortLivedToken = tokenData.access_token;

    // Step 2: Exchange short-lived token for a long-lived System User token
    // (60-day token — owners can reconnect before expiry)
    const longLivedUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
    longLivedUrl.searchParams.set("client_id", appId);
    longLivedUrl.searchParams.set("client_secret", appSecret);
    longLivedUrl.searchParams.set("fb_exchange_token", shortLivedToken);

    const longRes = await fetch(longLivedUrl.toString());
    if (!longRes.ok) {
      const body = await longRes.text();
      console.error("[whatsapp] Long-lived token exchange failed:", body);
      return res.status(502).json({ error: "Failed to obtain long-lived token from Meta" });
    }
    const longData = await longRes.json() as { access_token: string };
    const accessToken = longData.access_token;

    // Step 3: Fetch phone number display details from the Graph API
    let displayPhoneNumber: string | null = null;
    let businessName: string | null = null;

    try {
      const phoneUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}?fields=display_phone_number,verified_name&access_token=${accessToken}`;
      const phoneRes = await fetch(phoneUrl);
      if (phoneRes.ok) {
        const phoneData = await phoneRes.json() as { display_phone_number?: string; verified_name?: string };
        displayPhoneNumber = phoneData.display_phone_number ?? null;
        businessName = phoneData.verified_name ?? null;
      }
    } catch (err) {
      // Non-fatal — we still save the connection even if display info is unavailable
      console.warn("[whatsapp] Could not fetch phone number display info:", err);
    }

    // Step 4: Save the connection
    const { connectedAt } = await saveConnection(laundryId, {
      whatsappBusinessAccountId: wabaId,
      phoneNumberId,
      accessToken,
      displayPhoneNumber,
      businessName,
    });

    // Step 5: Audit + activation tracking (fire-and-forget)
    logAction({
      auth: req.auth!,
      laundryId,
      action: "whatsapp_connected",
      metadata: { method: "embedded_signup", wabaId, phoneNumberId },
    });
    trackActivationEvent(laundryId, "whatsapp_connected");

    console.log(`[whatsapp] Laundry ${laundryId} connected WhatsApp via Embedded Signup (WABA: ${wabaId})`);

    return res.json({
      connected: true,
      displayPhoneNumber,
      businessName,
      connectedAt,
    });
  } catch (err) {
    console.error("[whatsapp] POST /meta/callback error:", err);
    logAction({
      auth: req.auth!,
      laundryId,
      action: "whatsapp_connection_failed",
      metadata: { method: "embedded_signup", reason: String(err) },
    });
    return res.status(500).json({ error: "Failed to complete WhatsApp connection" });
  }
});

// ── POST /api/whatsapp/meta/start ─────────────────────────────────────────
// Logs the start of an Embedded Signup attempt. Fire-and-forget from frontend.

whatsappRouter.post("/meta/start", requireOwner, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;
  try {
    logAction({
      auth: req.auth!,
      laundryId,
      action: "whatsapp_connection_started",
      metadata: { method: "embedded_signup" },
    });
    return res.json({ started: true });
  } catch (err) {
    // Non-fatal — don't block the signup flow
    console.warn("[whatsapp] POST /meta/start log error:", err);
    return res.json({ started: true });
  }
});

// ── POST /api/whatsapp/connect ─────────────────────────────────────────────
// Manual credential entry fallback (used when Meta Embedded Signup is not
// configured or as a developer override).
// The access token is never returned to the client after storage.

whatsappRouter.post("/connect", requireOwner, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;

  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid connection data",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const {
    whatsappBusinessAccountId,
    phoneNumberId,
    accessToken,
    displayPhoneNumber,
    businessName,
  } = parsed.data;

  try {
    const { connectedAt } = await saveConnection(laundryId, {
      whatsappBusinessAccountId,
      phoneNumberId,
      accessToken,
      displayPhoneNumber,
      businessName,
    });

    logAction({
      auth: req.auth!,
      laundryId,
      action: "whatsapp_connected",
      metadata: { method: "manual", wabaId: whatsappBusinessAccountId, phoneNumberId },
    });
    trackActivationEvent(laundryId, "whatsapp_connected");

    console.log(`[whatsapp] Laundry ${laundryId} connected WhatsApp manually (WABA: ${whatsappBusinessAccountId})`);

    return res.json({
      connected: true,
      displayPhoneNumber: displayPhoneNumber ?? null,
      businessName: businessName ?? null,
      connectedAt,
    });
  } catch (err) {
    console.error("[whatsapp] POST /connect error:", err);
    return res.status(500).json({ error: "Failed to save WhatsApp connection" });
  }
});

// ── POST /api/whatsapp/disconnect ─────────────────────────────────────────
// Marks the WhatsApp connection as disconnected for this laundry.
// Also deactivates the provider_configs row so the message pipeline stops.

whatsappRouter.post("/disconnect", requireOwner, async (req: AuthRequest, res) => {
  const { laundryId } = req.auth!;

  try {
    const [existing] = await db
      .select({ id: whatsappConnections.id })
      .from(whatsappConnections)
      .where(eq(whatsappConnections.laundryId, laundryId));

    if (!existing) {
      return res.status(404).json({ error: "No WhatsApp connection found" });
    }

    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(whatsappConnections)
        .set({
          status: "disconnected",
          disconnectedAt: now,
          updatedAt: now,
        })
        .where(eq(whatsappConnections.laundryId, laundryId));

      await tx
        .update(providerConfigs)
        .set({ isActive: false, updatedAt: now })
        .where(
          and(
            eq(providerConfigs.laundryId, laundryId),
            eq(providerConfigs.provider, "whatsapp")
          )
        );
    });

    logAction({
      auth: req.auth!,
      laundryId,
      action: "whatsapp_disconnected",
      metadata: {},
    });

    console.log(`[whatsapp] Laundry ${laundryId} disconnected WhatsApp`);
    return res.json({ connected: false, disconnectedAt: now });
  } catch (err) {
    console.error("[whatsapp] POST /disconnect error:", err);
    return res.status(500).json({ error: "Failed to disconnect WhatsApp" });
  }
});
