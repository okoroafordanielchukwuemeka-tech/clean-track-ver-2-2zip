/**
 * WhatsApp Automation Service
 *
 * Rule-based engine that fires WhatsApp messages automatically when
 * order/payment events occur. Fire-and-forget — never throws to callers.
 *
 * Template variables: {{customerName}}, {{orderId}}, {{businessName}}
 */

import { db } from "@workspace/db";
import {
  automationRules,
  laundries,
  whatsappActivityLogs,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { providerRegistry } from "./providers/registry.js";

// ── Default rule templates ────────────────────────────────────────────────────

const DEFAULT_RULES = [
  {
    name: "Order Received",
    triggerEvent: "ORDER_CREATED",
    messageTemplate:
      "Hi {{customerName}}, your order has been received. We will update you when it is ready.",
    enabled: true,
  },
  {
    name: "Payment Confirmation",
    triggerEvent: "PAYMENT_RECEIVED",
    messageTemplate:
      "Hi {{customerName}}, your payment has been received successfully.",
    enabled: true,
  },
  {
    name: "Ready Notification",
    triggerEvent: "ORDER_READY",
    messageTemplate:
      "Hi {{customerName}}, your clothes are ready for pickup.",
    enabled: true,
  },
  {
    name: "Order Completed",
    triggerEvent: "ORDER_COMPLETED",
    messageTemplate:
      "Hi {{customerName}}, your order has been completed. Thank you for choosing us!",
    enabled: true,
  },
  {
    name: "Delivery Confirmation",
    triggerEvent: "ORDER_DELIVERED",
    messageTemplate:
      "Hi {{customerName}}, your order has been delivered. Thank you!",
    enabled: false,
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Seed the 5 default automation rules for a new laundry.
 * Safe to call multiple times — uses ON CONFLICT DO NOTHING.
 */
export async function initializeDefaultRules(laundryId: number): Promise<void> {
  try {
    for (const rule of DEFAULT_RULES) {
      await db
        .insert(automationRules)
        .values({ laundryId, ...rule })
        .onConflictDoNothing();
    }
    console.log(`[automation] Initialized default rules for laundry ${laundryId}`);
  } catch (err) {
    console.error("[automation] initializeDefaultRules failed:", err);
  }
}

export interface AutomationContext {
  laundryId: number;
  triggerEvent: string;
  customerName: string;
  customerPhone: string | null | undefined;
  orderId: string;
}

/**
 * Fire the automation for a given event. Non-blocking — always resolves
 * without throwing. Callers should NOT await unless they explicitly want
 * to wait for delivery confirmation.
 */
export async function fireAutomation(ctx: AutomationContext): Promise<void> {
  const { laundryId, triggerEvent, customerName, customerPhone, orderId } = ctx;

  try {
    // 1. Find enabled rule for this event + laundry
    const [rule] = await db
      .select()
      .from(automationRules)
      .where(
        and(
          eq(automationRules.laundryId, laundryId),
          eq(automationRules.triggerEvent, triggerEvent),
          eq(automationRules.enabled, true)
        )
      );

    if (!rule) return; // No enabled rule → nothing to do

    // 2. Skip if customer has no phone
    if (!customerPhone) {
      console.log(
        `[automation] Skipping ${triggerEvent} for order ${orderId} — no customer phone`
      );
      return;
    }

    // 3. Get business name for template
    const [laundry] = await db
      .select({ businessName: laundries.businessName })
      .from(laundries)
      .where(eq(laundries.id, laundryId));

    const businessName = laundry?.businessName ?? "CleanTrack";

    // 4. Render template
    const renderedMessage = renderTemplate(rule.messageTemplate, {
      customerName,
      orderId,
      businessName,
    });

    // 5. Get WhatsApp provider
    const provider = await providerRegistry.getProvider(laundryId, "whatsapp");
    if (!provider) {
      console.log(
        `[automation] No WhatsApp provider for laundry ${laundryId} — skipping ${triggerEvent}`
      );
      return;
    }

    // 6. Send message
    let providerMessageId: string | undefined;
    try {
      const result = await provider.send({ phone: customerPhone, body: renderedMessage });
      providerMessageId = result.providerMessageId;
    } catch (sendErr) {
      console.error(`[automation] Send failed for ${triggerEvent} order ${orderId}:`, sendErr);
      // Still log as attempted below
    }

    // 7. Audit log — SYSTEM_MESSAGE_SENT
    await db.insert(whatsappActivityLogs).values({
      laundryId,
      conversationId: null,
      actorType: "system",
      actorId: null,
      actorName: "Automation",
      action: "SYSTEM_MESSAGE_SENT",
      metadata: {
        triggerEvent,
        orderId,
        customerPhone,
        customerName,
        messageSnippet: renderedMessage.slice(0, 80),
        ruleId: rule.id,
        ruleName: rule.name,
        providerMessageId: providerMessageId ?? null,
      },
    });

    console.log(
      `[automation] ${triggerEvent} → sent to ${customerPhone} for order ${orderId} (rule #${rule.id})`
    );
  } catch (err) {
    // Non-fatal: never propagate to caller
    console.error(`[automation] fireAutomation failed for ${triggerEvent}:`, err);
  }
}
