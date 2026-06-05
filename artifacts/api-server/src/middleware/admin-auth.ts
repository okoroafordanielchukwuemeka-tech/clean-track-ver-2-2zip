import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AdminAuthPayload {
  type: "admin";
  adminId: number;
  email: string;
  name: string;
}

export interface AdminRequest extends Request {
  admin?: AdminAuthPayload;
}

const JWT_SECRET = process.env.JWT_SECRET || "clean-track-dev-secret-change-in-production";

export function signAdminToken(payload: AdminAuthPayload, expiresIn: string = "8h"): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Admin authentication required" });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AdminAuthPayload;
    if (payload.type !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired admin token" });
  }
}
