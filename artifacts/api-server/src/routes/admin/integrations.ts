import { Router } from "express";
import { db } from "@workspace/db";
import { whatsappConnections, providerConfigs } from "@workspace/db/schema";
import { count, eq } from "drizzle-orm";
import { getMetaEnv } from "../../lib/env-validation.js";

export const adminIntegrationsRouter = Router();

// GET /api/admin/integrations/platform
// Returns platform-level integration configuration status.
// NEVER returns raw credentials — only which env vars are set (boolean) and
// operational counts such as how many tenants have connected WhatsApp.

adminIntegrationsRouter.get("/platform", async (req, res) => {
  try {
    const host = req.get("host") ?? "your-domain.replit.app";
    const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
    const webhookBase = `${proto}://${host}`;

    const [waConnRow] = await db
      .select({ c: count() })
      .from(whatsappConnections)
      .where(eq(whatsappConnections.status, "connected"));

    const [providerRow] = await db
      .select({ c: count() })
      .from(providerConfigs)
      .where(eq(providerConfigs.provider, "whatsapp"));

    const meta = getMetaEnv();

    res.json({
      whatsapp: {
        embeddedSignupEnabled: !!meta.appId,
        metaAppIdSet:          !!meta.appId,
        metaAppSecretSet:      !!meta.appSecret,
        metaConfigIdSet:       !!meta.configId,
        webhookVerifyTokenSet: !!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
        appSecretSet:          !!process.env.WHATSAPP_APP_SECRET,
        webhookUrl:            `${webhookBase}/api/webhooks/whatsapp`,
        connectedTenants:      Number(waConnRow?.c ?? 0),
        configuredProviders:   Number(providerRow?.c ?? 0),
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to load platform integration status" });
  }
});
