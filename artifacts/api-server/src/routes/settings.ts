import { Router } from "express";
import { db } from "@workspace/db";
import { laundries } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";

export const settingsRouter = Router();

const slaSchema = z.object({
  standardTurnaroundHours: z.number().int().min(1).max(336),
  expressTurnaroundHours: z.number().int().min(1).max(336),
  premiumTurnaroundHours: z.number().int().min(1).max(336),
});

// Payment details are the sole source of truth for manual-payment reconciliation
// instructions — surfaced on receipts, the customer statement, and WhatsApp
// payment-reminder templates. Never hardcode bank/payment info elsewhere.
const paymentDetailsSchema = z.object({
  preferredMethod: z.enum(["bank_transfer", "cash", "pos", "other"]).optional(),
  bankName: z.string().trim().max(120).optional().or(z.literal("")),
  accountName: z.string().trim().max(120).optional().or(z.literal("")),
  accountNumber: z.string().trim().max(20).optional().or(z.literal("")),
  instructions: z.string().trim().max(1000).optional().or(z.literal("")),
}).superRefine((data, ctx) => {
  // Nigerian NUBAN account numbers are exactly 10 digits — validate format
  // when a value is present, but never require the field itself.
  if (data.accountNumber && !/^\d{10}$/.test(data.accountNumber)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accountNumber"], message: "Account number must be exactly 10 digits" });
  }
  if (data.preferredMethod === "bank_transfer" && (!data.bankName || !data.accountName || !data.accountNumber)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["preferredMethod"], message: "Bank name, account name and account number are required when bank transfer is the preferred method" });
  }
});

const businessProfileSchema = z.object({
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  logoUrl: z.string().optional(),
  notes: z.string().optional(),
  paymentDetails: paymentDetailsSchema.optional(),
});

const brandingSchema = z.object({
  brandColor: z.string().optional(),
  receiptHeaderName: z.string().optional(),
  receiptFooterText: z.string().optional(),
});

const operationalSchema = z.object({
  workingDays: z.array(z.string()).optional(),
  workingHoursStart: z.string().optional(),
  workingHoursEnd: z.string().optional(),
  requireItemVerification: z.boolean().optional(),
  autoAssignOrders: z.boolean().optional(),
  allowPartialPickup: z.boolean().optional(),
  allowWorkersCreateCustomers: z.boolean().optional(),
  allowWorkersRecordPayments: z.boolean().optional(),
});

const automationSchema = z.object({
  orderReadyAlerts: z.boolean().optional(),
  paymentReminderAlerts: z.boolean().optional(),
  pickupReminderAlerts: z.boolean().optional(),
  overdueAlerts: z.boolean().optional(),
  dueSoonAlerts: z.boolean().optional(),
});

const dashboardPrefsSchema = z.object({
  showRevenue: z.boolean().optional(),
  showExpenses: z.boolean().optional(),
  showProfit: z.boolean().optional(),
  showWorkerPerformance: z.boolean().optional(),
  showNotifications: z.boolean().optional(),
  showOperationalInsights: z.boolean().optional(),
});

async function getLaundry(laundryId: number) {
  const [laundry] = await db.select().from(laundries).where(eq(laundries.id, laundryId));
  return laundry;
}

settingsRouter.get("/sla", async (req: AuthRequest, res) => {
  try {
    const laundry = await getLaundry(req.auth!.laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    res.json({
      standardTurnaroundHours: laundry.standardTurnaroundHours,
      expressTurnaroundHours: laundry.expressTurnaroundHours,
      premiumTurnaroundHours: laundry.premiumTurnaroundHours,
    });
  } catch {
    res.status(500).json({ error: "Failed to get SLA settings" });
  }
});

settingsRouter.patch("/sla", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const data = slaSchema.partial().parse(req.body);
    const [updated] = await db.update(laundries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(laundries.id, laundryId))
      .returning();
    if (!updated) return res.status(404).json({ error: "Laundry not found" });
    res.json({
      standardTurnaroundHours: updated.standardTurnaroundHours,
      expressTurnaroundHours: updated.expressTurnaroundHours,
      premiumTurnaroundHours: updated.premiumTurnaroundHours,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update SLA settings" });
  }
});

settingsRouter.get("/business-profile", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundry = await getLaundry(req.auth!.laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    res.json({
      businessName: laundry.businessName,
      phone: laundry.phone,
      ...(laundry.businessProfile as object ?? {}),
    });
  } catch {
    res.status(500).json({ error: "Failed to get business profile" });
  }
});

settingsRouter.patch("/business-profile", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const { businessName, phone, ...profileData } = businessProfileSchema.extend({
      businessName: z.string().min(2).optional(),
      phone: z.string().optional(),
    }).parse(req.body);

    const laundry = await getLaundry(laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });

    const currentProfile = (laundry.businessProfile as object) ?? {};
    const mergedProfile = { ...currentProfile, ...profileData };

    const updateData: Record<string, unknown> = { businessProfile: mergedProfile, updatedAt: new Date() };
    if (businessName) updateData.businessName = businessName;
    if (phone !== undefined) updateData.phone = phone;

    const [updated] = await db.update(laundries).set(updateData).where(eq(laundries.id, laundryId)).returning();
    res.json({ businessName: updated.businessName, phone: updated.phone, ...(updated.businessProfile as object ?? {}) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update business profile" });
  }
});

settingsRouter.get("/branding", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundry = await getLaundry(req.auth!.laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    res.json(laundry.brandingSettings ?? {});
  } catch {
    res.status(500).json({ error: "Failed to get branding settings" });
  }
});

settingsRouter.patch("/branding", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const data = brandingSchema.parse(req.body);
    const laundry = await getLaundry(laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    const merged = { ...(laundry.brandingSettings as object ?? {}), ...data };
    const [updated] = await db.update(laundries).set({ brandingSettings: merged, updatedAt: new Date() })
      .where(eq(laundries.id, laundryId)).returning();
    res.json(updated.brandingSettings ?? {});
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update branding settings" });
  }
});

settingsRouter.get("/operational", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundry = await getLaundry(req.auth!.laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    res.json({
      standardTurnaroundHours: laundry.standardTurnaroundHours,
      expressTurnaroundHours: laundry.expressTurnaroundHours,
      premiumTurnaroundHours: laundry.premiumTurnaroundHours,
      ...(laundry.operationalSettings as object ?? {}),
    });
  } catch {
    res.status(500).json({ error: "Failed to get operational settings" });
  }
});

settingsRouter.patch("/operational", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const { ...opData } = operationalSchema.merge(slaSchema.partial()).parse(req.body);
    const { standardTurnaroundHours, expressTurnaroundHours, premiumTurnaroundHours, ...rest } = opData as any;
    const laundry = await getLaundry(laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    const merged = { ...(laundry.operationalSettings as object ?? {}), ...rest };
    const updateData: Record<string, unknown> = { operationalSettings: merged, updatedAt: new Date() };
    if (standardTurnaroundHours !== undefined) updateData.standardTurnaroundHours = standardTurnaroundHours;
    if (expressTurnaroundHours !== undefined) updateData.expressTurnaroundHours = expressTurnaroundHours;
    if (premiumTurnaroundHours !== undefined) updateData.premiumTurnaroundHours = premiumTurnaroundHours;
    const [updated] = await db.update(laundries).set(updateData).where(eq(laundries.id, laundryId)).returning();
    res.json({
      standardTurnaroundHours: updated.standardTurnaroundHours,
      expressTurnaroundHours: updated.expressTurnaroundHours,
      premiumTurnaroundHours: updated.premiumTurnaroundHours,
      ...(updated.operationalSettings as object ?? {}),
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update operational settings" });
  }
});

settingsRouter.get("/automation", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundry = await getLaundry(req.auth!.laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    res.json(laundry.automationSettings ?? {});
  } catch {
    res.status(500).json({ error: "Failed to get automation settings" });
  }
});

settingsRouter.patch("/automation", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const data = automationSchema.parse(req.body);
    const laundry = await getLaundry(laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    const merged = { ...(laundry.automationSettings as object ?? {}), ...data };
    const [updated] = await db.update(laundries).set({ automationSettings: merged, updatedAt: new Date() })
      .where(eq(laundries.id, laundryId)).returning();
    res.json(updated.automationSettings ?? {});
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update automation settings" });
  }
});

settingsRouter.get("/dashboard-preferences", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundry = await getLaundry(req.auth!.laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    res.json(laundry.dashboardPreferences ?? {});
  } catch {
    res.status(500).json({ error: "Failed to get dashboard preferences" });
  }
});

settingsRouter.patch("/dashboard-preferences", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const data = dashboardPrefsSchema.parse(req.body);
    const laundry = await getLaundry(laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    const merged = { ...(laundry.dashboardPreferences as object ?? {}), ...data };
    const [updated] = await db.update(laundries).set({ dashboardPreferences: merged, updatedAt: new Date() })
      .where(eq(laundries.id, laundryId)).returning();
    res.json(updated.dashboardPreferences ?? {});
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update dashboard preferences" });
  }
});

const discountSettingsSchema = z.object({
  maxDiscountPerOrder: z.number().min(0).optional(),
  maxDiscountPercentage: z.number().min(0).max(100).optional(),
  autoApprovalThreshold: z.number().min(0).optional(),
});

settingsRouter.get("/discount-rules", requireOwner, async (req: AuthRequest, res) => {
  try {
    const laundry = await getLaundry(req.auth!.laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    const settings = (laundry.discountSettings ?? {}) as {
      maxDiscountPerOrder?: number;
      maxDiscountPercentage?: number;
      autoApprovalThreshold?: number;
    };
    res.json({
      maxDiscountPerOrder: settings.maxDiscountPerOrder ?? 0,
      maxDiscountPercentage: settings.maxDiscountPercentage ?? 0,
      autoApprovalThreshold: settings.autoApprovalThreshold ?? 0,
    });
  } catch {
    res.status(500).json({ error: "Failed to get discount rules" });
  }
});

settingsRouter.patch("/discount-rules", requireOwner, async (req: AuthRequest, res) => {
  try {
    const { laundryId } = req.auth!;
    const data = discountSettingsSchema.parse(req.body);
    const laundry = await getLaundry(laundryId);
    if (!laundry) return res.status(404).json({ error: "Laundry not found" });
    const merged = { ...(laundry.discountSettings as object ?? {}), ...data };
    const [updated] = await db.update(laundries).set({ discountSettings: merged, updatedAt: new Date() })
      .where(eq(laundries.id, laundryId)).returning();
    res.json(updated.discountSettings ?? {});
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Failed to update discount rules" });
  }
});
