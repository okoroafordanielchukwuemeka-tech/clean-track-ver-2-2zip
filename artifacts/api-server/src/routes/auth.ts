import { Router } from "express";
import { db } from "@workspace/db";
import {
  laundries,
  branches,
  services,
  workers,
  workerPermissions,
  expenseCategories,
  messageTemplates,
  passwordResetTokens,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_MESSAGE_TEMPLATES,
  ADMIN_DEFAULT_PERMISSIONS,
  WORKER_DEFAULT_PERMISSIONS,
} from "@workspace/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { signToken, requireAuth, AuthRequest } from "../middleware/auth.js";
import { sendPasswordResetEmail, sendWelcomeEmail, generateEmailTrackingToken, verifyEmailTrackingToken } from "../lib/email-service.js";
import { trackActivationEvent } from "../lib/activation-tracker.js";
import { warn } from "../lib/logger.js";

export const authRouter = Router();

// ── Max failed attempts before account lock ────────────────────────────────
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// ── Input schemas ──────────────────────────────────────────────────────────

const ownerSignupSchema = z.object({
  businessName: z.string().min(2, "Business name must be at least 2 characters"),
  ownerEmail: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  phone: z.string().optional(),
});

const ownerLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const workerLoginSchema = z.object({
  phone: z.string().min(1, "Phone number required"),
  pin: z.string().min(4, "PIN required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function seedLaundryDefaults(laundryId: number) {
  // Auto-create a default "Main Branch" so new owners are never on an empty system
  await db
    .insert(branches)
    .values({ laundryId, name: "Main Branch" })
    .onConflictDoNothing();

  // Seed common Nigerian laundry services with NGN pricing
  await db
    .insert(services)
    .values([
      { laundryId, name: "Shirt Wash & Iron", category: "Washing", standardPrice: "800", expressPrice: "1200", premiumPrice: "1500" },
      { laundryId, name: "Trouser Wash & Iron", category: "Washing", standardPrice: "1000", expressPrice: "1500", premiumPrice: "2000" },
      { laundryId, name: "Suit Cleaning", category: "Dry Cleaning", standardPrice: "3500", expressPrice: "5000", premiumPrice: "6500" },
      { laundryId, name: "Dress / Gown Cleaning", category: "Washing", standardPrice: "2000", expressPrice: "3000", premiumPrice: "4000" },
      { laundryId, name: "Duvet / Bedsheet Wash", category: "Heavy Items", standardPrice: "3000", expressPrice: "4500", premiumPrice: "6000" },
      { laundryId, name: "Shoe Cleaning", category: "Specialty", standardPrice: "1500", expressPrice: "2500", premiumPrice: "3500" },
      { laundryId, name: "Dry Cleaning", category: "Dry Cleaning", standardPrice: "2500", expressPrice: "4000", premiumPrice: "5500" },
      { laundryId, name: "Express Wash", category: "Washing", standardPrice: "1200", expressPrice: "2000", premiumPrice: "2500" },
    ])
    .onConflictDoNothing();

  await db
    .insert(expenseCategories)
    .values(
      DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
        laundryId,
        name,
        isDefault: true,
        isActive: true,
      }))
    )
    .onConflictDoNothing();

  await db
    .insert(messageTemplates)
    .values(
      DEFAULT_MESSAGE_TEMPLATES.map((t) => ({
        laundryId,
        name: t.name,
        subject: t.subject,
        body: t.body,
        isDefault: true,
        isActive: true,
      }))
    )
    .onConflictDoNothing();
}

// Get the base URL for reset links (frontend origin)
function getAppBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "http://localhost:5000";
}

// ── POST /auth/signup ──────────────────────────────────────────────────────

authRouter.post("/signup", async (req, res) => {
  try {
    const data = ownerSignupSchema.parse(req.body);

    const [existing] = await db
      .select()
      .from(laundries)
      .where(eq(laundries.ownerEmail, data.ownerEmail.toLowerCase()));
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const trialStartedAt = new Date();
    const trialDurationDays = 14;
    const trialEndsAt = new Date(trialStartedAt.getTime() + trialDurationDays * 86_400_000);

    const [laundry] = await db
      .insert(laundries)
      .values({
        businessName: data.businessName,
        ownerEmail: data.ownerEmail.toLowerCase(),
        passwordHash,
        phone: data.phone,
        subscriptionStatus: "trial",
        trialStartedAt,
        trialEndsAt,
        trialDurationDays,
        passwordChangedAt: trialStartedAt,
      })
      .returning();

    await seedLaundryDefaults(laundry.id);

    // Activation tracking — fire-and-forget, never delays signup response
    trackActivationEvent(laundry.id, "workspace_created");
    trackActivationEvent(laundry.id, "branch_created"); // auto-seeded in seedLaundryDefaults
    trackActivationEvent(laundry.id, "service_created"); // auto-seeded in seedLaundryDefaults

    // Welcome email — non-blocking
    sendWelcomeEmail(laundry.ownerEmail, laundry.businessName, laundry.id, getAppBaseUrl())
      .then(() => trackActivationEvent(laundry.id, "welcome_email_sent"))
      .catch(() => {});

    const token = signToken({
      laundryId: laundry.id,
      type: "owner",
      ownerId: laundry.id,
      email: laundry.ownerEmail,
      name: laundry.businessName,
      passwordChangedAt: laundry.passwordChangedAt?.toISOString(),
    });

    const { passwordHash: _ph, ...safeLaundry } = laundry;

    res.status(201).json({
      token,
      laundry: safeLaundry,
      user: {
        type: "owner",
        id: laundry.id,
        name: laundry.businessName,
        email: laundry.ownerEmail,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Signup failed" });
  }
});

// ── POST /auth/demo-login ──────────────────────────────────────────────────
// Dedicated low-rate-limited endpoint for the public demo account.
// Uses hardcoded demo credentials so the auth limiter never blocks public demos.

const DEMO_EMAIL = "demo@cleantrack.ng";

authRouter.post("/demo-login", async (req, res) => {
  try {
    const [laundry] = await db
      .select()
      .from(laundries)
      .where(eq(laundries.ownerEmail, DEMO_EMAIL));

    if (!laundry || !laundry.isActive || !laundry.passwordHash) {
      return res.status(503).json({ error: "Demo account not available" });
    }

    const DEMO_PASSWORD = "Demo@1234";
    const valid = await bcrypt.compare(DEMO_PASSWORD, laundry.passwordHash);
    if (!valid) {
      return res.status(503).json({ error: "Demo account not configured" });
    }

    const token = signToken({
      laundryId: laundry.id,
      type: "owner",
      ownerId: laundry.id,
      email: laundry.ownerEmail,
      name: laundry.businessName,
      passwordChangedAt: laundry.passwordChangedAt?.toISOString(),
    });

    res.json({
      token,
      user: {
        type: "owner",
        id: laundry.id,
        name: laundry.businessName,
        email: laundry.ownerEmail,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Demo login failed" });
  }
});

// ── POST /auth/owner-login ─────────────────────────────────────────────────

authRouter.post("/owner-login", async (req, res) => {
  try {
    const data = ownerLoginSchema.parse(req.body);

    const [laundry] = await db
      .select()
      .from(laundries)
      .where(eq(laundries.ownerEmail, data.email.toLowerCase()));

    if (!laundry || !laundry.isActive) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // ── Account lockout check ──────────────────────────────────────────
    if (laundry.lockedUntil && laundry.lockedUntil > new Date()) {
      const remaining = Math.ceil((laundry.lockedUntil.getTime() - Date.now()) / 60_000);
      return res.status(401).json({
        error: `Account temporarily locked due to too many failed attempts. Try again in ${remaining} minute${remaining !== 1 ? "s" : ""}.`,
        locked: true,
        lockedUntil: laundry.lockedUntil.toISOString(),
      });
    }

    const valid = await bcrypt.compare(data.password, laundry.passwordHash);

    if (!valid) {
      // ── Increment failure counter ──────────────────────────────────
      const newAttempts = (laundry.failedLoginAttempts ?? 0) + 1;
      const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;

      await db
        .update(laundries)
        .set({
          failedLoginAttempts: newAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
          updatedAt: new Date(),
        })
        .where(eq(laundries.id, laundry.id));

      if (shouldLock) {
        warn("[auth] Account locked after failed attempts", {
          laundryId: laundry.id,
          attempts: newAttempts,
        });
        return res.status(401).json({
          error: `Too many failed attempts. Account locked for ${LOCKOUT_DURATION_MS / 60_000} minutes.`,
          locked: true,
        });
      }

      const attemptsLeft = MAX_FAILED_ATTEMPTS - newAttempts;
      return res.status(401).json({
        error: `Invalid email or password. ${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} remaining before lockout.`,
      });
    }

    // ── Successful login — reset failure counter ───────────────────────
    await db
      .update(laundries)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(laundries.id, laundry.id));

    // Track return login (7+ days after signup)
    if (laundry.createdAt) {
      const daysSinceCreation = (Date.now() - new Date(laundry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation >= 7) {
        trackActivationEvent(laundry.id, "first_return_login");
      }
    }

    const token = signToken({
      laundryId: laundry.id,
      type: "owner",
      ownerId: laundry.id,
      email: laundry.ownerEmail,
      name: laundry.businessName,
      passwordChangedAt: laundry.passwordChangedAt?.toISOString(),
    });

    const { passwordHash: _ph, ...safeLaundry } = laundry;

    res.json({
      token,
      laundry: safeLaundry,
      user: {
        type: "owner",
        id: laundry.id,
        name: laundry.businessName,
        email: laundry.ownerEmail,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Login failed" });
  }
});

// ── POST /auth/worker-login ────────────────────────────────────────────────

authRouter.post("/worker-login", async (req, res) => {
  try {
    const data = workerLoginSchema.parse(req.body);

    const allMatching = await db
      .select()
      .from(workers)
      .where(and(eq(workers.phone, data.phone), eq(workers.isActive, true)));

    if (!allMatching.length) {
      return res.status(401).json({ error: "Invalid phone number or PIN" });
    }

    const now = new Date();

    // ── Separate locked vs unlocked accounts ──────────────────────────
    const lockedWorkers = allMatching.filter(
      (w) => w.pinLockedUntil && w.pinLockedUntil > now
    );
    const unlockedWorkers = allMatching.filter(
      (w) => !w.pinLockedUntil || w.pinLockedUntil <= now
    );

    // ── Try PIN against every unlocked worker (bcrypt only — no plaintext) ─
    let matchedWorker = null;
    const triedWorkers: typeof allMatching = [];

    for (const w of unlockedWorkers) {
      if (!w.pin) continue;
      triedWorkers.push(w);
      const valid = await bcrypt.compare(data.pin, w.pin);
      if (valid) {
        matchedWorker = w;
        break;
      }
    }

    if (!matchedWorker) {
      // ── PIN did not match any unlocked worker ──────────────────────
      if (triedWorkers.length > 0) {
        // Increment failed attempt counter; lock if threshold reached
        let anyJustLocked = false;
        let attemptsLeftAfter = MAX_FAILED_ATTEMPTS;

        for (const w of triedWorkers) {
          const newAttempts = (w.failedPinAttempts ?? 0) + 1;
          const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;
          if (shouldLock) anyJustLocked = true;

          await db
            .update(workers)
            .set({
              failedPinAttempts: newAttempts,
              pinLockedUntil: shouldLock
                ? new Date(now.getTime() + LOCKOUT_DURATION_MS)
                : null,
              updatedAt: now,
            })
            .where(eq(workers.id, w.id));

          if (shouldLock) {
            warn("[auth] Worker PIN account locked after failed attempts", {
              workerId: w.id,
              attempts: newAttempts,
            });
          }

          // Report attempts remaining based on the first tried worker
          if (w === triedWorkers[0]) {
            attemptsLeftAfter = MAX_FAILED_ATTEMPTS - newAttempts;
          }
        }

        if (anyJustLocked) {
          return res.status(401).json({
            error: `Too many failed attempts. Account locked for ${LOCKOUT_DURATION_MS / 60_000} minutes.`,
            locked: true,
          });
        }

        return res.status(401).json({
          error: `Invalid phone number or PIN. ${attemptsLeftAfter} attempt${attemptsLeftAfter !== 1 ? "s" : ""} remaining before lockout.`,
        });
      }

      // ── All matching workers are locked — report earliest unlock time ─
      if (lockedWorkers.length > 0) {
        const earliest = lockedWorkers.reduce(
          (min, w) => (w.pinLockedUntil! < min ? w.pinLockedUntil! : min),
          lockedWorkers[0].pinLockedUntil!
        );
        const remaining = Math.ceil((earliest.getTime() - now.getTime()) / 60_000);
        return res.status(401).json({
          error: `Account temporarily locked due to too many failed attempts. Try again in ${remaining} minute${remaining !== 1 ? "s" : ""}.`,
          locked: true,
          lockedUntil: earliest.toISOString(),
        });
      }

      // No worker had a PIN set
      return res.status(401).json({ error: "Invalid phone number or PIN" });
    }

    // ── Successful login — reset failure counters ──────────────────────
    await db
      .update(workers)
      .set({ failedPinAttempts: 0, pinLockedUntil: null, updatedAt: now })
      .where(eq(workers.id, matchedWorker.id));

    const worker = matchedWorker;

    if (!worker.laundryId) {
      return res.status(401).json({ error: "Invalid phone number or PIN" });
    }

    let [permsRow] = await db
      .select()
      .from(workerPermissions)
      .where(eq(workerPermissions.workerId, worker.id));

    if (!permsRow) {
      const defaults =
        worker.role === "admin" ? ADMIN_DEFAULT_PERMISSIONS : WORKER_DEFAULT_PERMISSIONS;
      [permsRow] = await db
        .insert(workerPermissions)
        .values({ workerId: worker.id, laundryId: worker.laundryId, ...defaults })
        .returning();
    }

    const permissions = {
      canViewOrders: permsRow.canViewOrders,
      canProcessOrders: permsRow.canProcessOrders,
      canRecordPayments: permsRow.canRecordPayments,
      canRecordPickups: permsRow.canRecordPickups,
      canViewCustomers: permsRow.canViewCustomers,
      canCreateCustomers: permsRow.canCreateCustomers,
      canViewCustomerBalances: permsRow.canViewCustomerBalances,
      canAssignOrders: permsRow.canAssignOrders,
    };

    const token = signToken(
      {
        laundryId: worker.laundryId,
        type: "worker",
        workerId: worker.id,
        workerRole: worker.role as "admin" | "worker",
        branchId: worker.branchId ?? undefined,
        name: worker.name,
        permissions,
        pinChangedAt: worker.pinChangedAt?.toISOString(),
      },
      "12h"
    );

    const { pin: _pin, ...safeWorker } = worker;

    res.json({
      token,
      worker: safeWorker,
      user: {
        type: "worker",
        id: worker.id,
        name: worker.name,
        phone: worker.phone,
        role: worker.role,
        laundryId: worker.laundryId,
        permissions,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Login failed" });
  }
});

// ── GET /auth/me ───────────────────────────────────────────────────────────

authRouter.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const auth = req.auth!;
    if (auth.type === "owner") {
      const [laundry] = await db
        .select()
        .from(laundries)
        .where(eq(laundries.id, auth.laundryId));
      if (!laundry) return res.status(404).json({ error: "Account not found" });
      const { passwordHash: _ph, ...safeLaundry } = laundry;
      return res.json({
        type: "owner",
        id: laundry.id,
        name: laundry.businessName,
        email: laundry.ownerEmail,
        laundry: safeLaundry,
      });
    } else {
      const [worker] = await db
        .select()
        .from(workers)
        .where(eq(workers.id, auth.workerId!));
      if (!worker) return res.status(404).json({ error: "Worker not found" });
      const { pin: _pin, ...safeWorker } = worker;
      return res.json({
        type: "worker",
        id: worker.id,
        name: worker.name,
        phone: worker.phone,
        role: worker.role,
        laundryId: worker.laundryId,
        worker: safeWorker,
      });
    }
  } catch {
    res.status(500).json({ error: "Failed to get user" });
  }
});

// ── POST /auth/forgot-password ─────────────────────────────────────────────
// Always returns 200 to prevent email enumeration — attacker cannot tell
// whether the submitted email belongs to a real account.

authRouter.post("/forgot-password", async (req, res) => {
  try {
    const data = forgotPasswordSchema.parse(req.body);
    const email = data.email.toLowerCase();

    // Purge expired tokens first (keep DB tidy)
    await db
      .delete(passwordResetTokens)
      .where(lt(passwordResetTokens.expiresAt, new Date()))
      .catch(() => {});

    const [laundry] = await db
      .select({ id: laundries.id, businessName: laundries.businessName, ownerEmail: laundries.ownerEmail, isActive: laundries.isActive })
      .from(laundries)
      .where(eq(laundries.ownerEmail, email));

    // Always respond 200 — never reveal whether email exists
    if (!laundry || !laundry.isActive) {
      return res.json({ message: "If that email is registered, a reset link has been sent." });
    }

    // Generate a cryptographically secure random token (never stored raw)
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing tokens for this account before creating a new one
    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.laundryId, laundry.id))
      .catch(() => {});

    await db.insert(passwordResetTokens).values({
      laundryId: laundry.id,
      tokenHash,
      expiresAt,
    });

    const resetUrl = `${getAppBaseUrl()}/reset-password?token=${rawToken}`;

    await sendPasswordResetEmail(laundry.ownerEmail, laundry.businessName, resetUrl);

    return res.json({ message: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    // Still return generic message to prevent enumeration even on internal errors
    res.json({ message: "If that email is registered, a reset link has been sent." });
  }
});

// ── POST /auth/reset-password ──────────────────────────────────────────────

authRouter.post("/reset-password", async (req, res) => {
  try {
    const data = resetPasswordSchema.parse(req.body);
    const tokenHash = hashToken(data.token);

    const [tokenRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash));

    // Unified error message — prevents token enumeration
    const INVALID_MSG = "This reset link is invalid or has expired. Please request a new one.";

    if (!tokenRow) return res.status(400).json({ error: INVALID_MSG });
    if (tokenRow.usedAt) return res.status(400).json({ error: INVALID_MSG });
    if (tokenRow.expiresAt < new Date()) return res.status(400).json({ error: INVALID_MSG });

    const newPasswordHash = await bcrypt.hash(data.newPassword, 12);
    const now = new Date();

    // Update password, set passwordChangedAt to invalidate all existing sessions
    await db
      .update(laundries)
      .set({
        passwordHash: newPasswordHash,
        passwordChangedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(laundries.id, tokenRow.laundryId));

    // Mark token as used (single-use enforcement)
    await db
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(eq(passwordResetTokens.id, tokenRow.id));

    res.json({ message: "Password reset successfully. You can now log in with your new password." });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Password reset failed. Please try again." });
  }
});

// ── POST /auth/change-password ─────────────────────────────────────────────
// Authenticated endpoint — requires current password to prevent session hijacking.

authRouter.post("/change-password", requireAuth, async (req: AuthRequest, res) => {
  try {
    const auth = req.auth!;
    if (auth.type !== "owner") {
      return res.status(403).json({ error: "Only account owners can change their password" });
    }

    const data = changePasswordSchema.parse(req.body);

    const [laundry] = await db
      .select()
      .from(laundries)
      .where(eq(laundries.id, auth.laundryId));

    if (!laundry) return res.status(404).json({ error: "Account not found" });

    const currentValid = await bcrypt.compare(data.currentPassword, laundry.passwordHash);
    if (!currentValid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    if (data.currentPassword === data.newPassword) {
      return res.status(400).json({ error: "New password must be different from your current password" });
    }

    const newPasswordHash = await bcrypt.hash(data.newPassword, 12);
    const now = new Date();

    await db
      .update(laundries)
      .set({ passwordHash: newPasswordHash, passwordChangedAt: now, updatedAt: now })
      .where(eq(laundries.id, laundry.id));

    // Issue a fresh token with the updated passwordChangedAt so the current session stays valid
    const newToken = signToken({
      laundryId: laundry.id,
      type: "owner",
      ownerId: laundry.id,
      email: laundry.ownerEmail,
      name: laundry.businessName,
      passwordChangedAt: now.toISOString(),
    });

    res.json({ message: "Password changed successfully.", token: newToken });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Password change failed" });
  }
});

// ── GET /auth/email-track — Welcome email open/click tracking ──────────────
// Used by the 1×1 pixel in the welcome email (open) and tracked login links (click).
// Public — no auth required (email clients must be able to load the pixel).

authRouter.get("/email-track", async (req, res) => {
  try {
    const { t, lid, e, url } = req.query as Record<string, string | undefined>;
    const laundryId = lid ? parseInt(lid, 10) : NaN;

    if (t && !isNaN(laundryId) && e) {
      if (verifyEmailTrackingToken(t, laundryId)) {
        if (e === "opened") trackActivationEvent(laundryId, "welcome_email_opened");
        if (e === "clicked") trackActivationEvent(laundryId, "welcome_email_clicked");
      }
    }

    if (e === "clicked" && url) {
      return res.redirect(302, decodeURIComponent(url));
    }

    // 1×1 transparent GIF pixel
    const pixel = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64"
    );
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.end(pixel);
  } catch {
    res.status(204).end();
  }
});
