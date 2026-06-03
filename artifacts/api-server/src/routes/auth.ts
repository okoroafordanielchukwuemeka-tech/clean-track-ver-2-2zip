import { Router } from "express";
import { db } from "@workspace/db";
import { laundries, workers, workerPermissions, expenseCategories, messageTemplates, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_MESSAGE_TEMPLATES, ADMIN_DEFAULT_PERMISSIONS, WORKER_DEFAULT_PERMISSIONS } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { signToken, requireAuth, AuthRequest } from "../middleware/auth.js";

export const authRouter = Router();

const ownerSignupSchema = z.object({
  businessName: z.string().min(2, "Business name must be at least 2 characters"),
  ownerEmail: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
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

async function seedLaundryDefaults(laundryId: number) {
  await db.insert(expenseCategories).values(
    DEFAULT_EXPENSE_CATEGORIES.map(name => ({
      laundryId,
      name,
      isDefault: true,
      isActive: true,
    }))
  ).onConflictDoNothing();

  await db.insert(messageTemplates).values(
    DEFAULT_MESSAGE_TEMPLATES.map(t => ({
      laundryId,
      name: t.name,
      subject: t.subject,
      body: t.body,
      isDefault: true,
      isActive: true,
    }))
  ).onConflictDoNothing();
}

authRouter.post("/signup", async (req, res) => {
  try {
    const data = ownerSignupSchema.parse(req.body);

    const [existing] = await db.select().from(laundries)
      .where(eq(laundries.ownerEmail, data.ownerEmail.toLowerCase()));
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const [laundry] = await db.insert(laundries).values({
      businessName: data.businessName,
      ownerEmail: data.ownerEmail.toLowerCase(),
      passwordHash,
      phone: data.phone,
    }).returning();

    await seedLaundryDefaults(laundry.id);

    const token = signToken({
      laundryId: laundry.id,
      type: "owner",
      ownerId: laundry.id,
      email: laundry.ownerEmail,
      name: laundry.businessName,
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

authRouter.post("/owner-login", async (req, res) => {
  try {
    const data = ownerLoginSchema.parse(req.body);

    const [laundry] = await db.select().from(laundries)
      .where(eq(laundries.ownerEmail, data.email.toLowerCase()));

    if (!laundry || !laundry.isActive) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(data.password, laundry.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken({
      laundryId: laundry.id,
      type: "owner",
      ownerId: laundry.id,
      email: laundry.ownerEmail,
      name: laundry.businessName,
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

authRouter.post("/worker-login", async (req, res) => {
  try {
    const data = workerLoginSchema.parse(req.body);

    const allMatching = await db.select().from(workers)
      .where(and(eq(workers.phone, data.phone), eq(workers.isActive, true)));

    if (!allMatching.length) {
      return res.status(401).json({ error: "Invalid phone number or PIN" });
    }

    let worker = null;
    for (const w of allMatching) {
      if (!w.pin) continue;
      const isHashed = w.pin.startsWith("$2");
      const valid = isHashed
        ? await bcrypt.compare(data.pin, w.pin)
        : w.pin === data.pin;
      if (valid) { worker = w; break; }
    }

    if (!worker || !worker.laundryId) {
      return res.status(401).json({ error: "Invalid phone number or PIN" });
    }

    // Fetch or create worker permissions row
    let [permsRow] = await db.select().from(workerPermissions)
      .where(eq(workerPermissions.workerId, worker.id));

    if (!permsRow) {
      const defaults = worker.role === "admin" ? ADMIN_DEFAULT_PERMISSIONS : WORKER_DEFAULT_PERMISSIONS;
      [permsRow] = await db.insert(workerPermissions).values({
        workerId: worker.id,
        laundryId: worker.laundryId,
        ...defaults,
      }).returning();
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

authRouter.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const auth = req.auth!;
    if (auth.type === "owner") {
      const [laundry] = await db.select().from(laundries)
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
      const [worker] = await db.select().from(workers)
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
