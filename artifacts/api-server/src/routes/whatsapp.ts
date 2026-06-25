import { Router } from "express";
import { db } from "@workspace/db";
import { whatsappConnections, providerConfigs } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { AuthRequest, requireOwner } from "../middleware/auth.js";

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

// ── POST /api/whatsapp/connect ─────────────────────────────────────────────
// Stores a new WhatsApp connection for this laundry.
// Called after the Meta Embedded Signup flow completes in the frontend.
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

    console.log(`[whatsapp] Laundry ${laundryId} connected WhatsApp (WABA: ${whatsappBusinessAccountId})`);

    return res.json({
      connected: true,
      displayPhoneNumber: displayPhoneNumber ?? null,
      businessName: businessName ?? null,
      connectedAt: now,
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

    console.log(`[whatsapp] Laundry ${laundryId} disconnected WhatsApp`);
    return res.json({ connected: false, disconnectedAt: now });
  } catch (err) {
    console.error("[whatsapp] POST /disconnect error:", err);
    return res.status(500).json({ error: "Failed to disconnect WhatsApp" });
  }
});
