import { Router } from "express";
import { db } from "@workspace/db";
import { platformAdmins } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { signAdminToken, requireAdmin, AdminRequest } from "../../middleware/admin-auth.js";

export const adminAuthRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

adminAuthRouter.post("/login", async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);

    const [admin] = await db.select().from(platformAdmins)
      .where(eq(platformAdmins.email, data.email.toLowerCase()));

    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(data.password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signAdminToken({
      type: "admin",
      adminId: admin.id,
      email: admin.email,
      name: admin.name,
    });

    res.json({
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0].message });
    res.status(500).json({ error: "Login failed" });
  }
});

adminAuthRouter.get("/me", requireAdmin, (req: AdminRequest, res) => {
  res.json({ admin: req.admin });
});
