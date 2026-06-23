import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AdminRole } from "@workspace/db/schema";

export interface AdminAuthPayload {
  type: "admin";
  adminId: number;
  email: string;
  name: string;
  role: AdminRole;
}

export interface AdminRequest extends Request {
  admin?: AdminAuthPayload;
}

// Payload embedded in an owner JWT when an admin is impersonating a tenant.
export interface ImpersonatedByPayload {
  adminId: number;
  adminName: string;
  adminEmail: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "FATAL: JWT_SECRET environment variable is not set. Server cannot authenticate admin requests."
    );
  }
  return secret;
}

export function signAdminToken(payload: AdminAuthPayload, expiresIn: string = "8h"): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn } as jwt.SignOptions);
}

/**
 * Signs a short-lived (2h) owner-type JWT for admin impersonation.
 * The `impersonatedBy` field lets the frontend detect and display the banner.
 */
export function signImpersonationToken(
  ownerPayload: Record<string, unknown>,
  impersonatedBy: ImpersonatedByPayload,
  expiresIn: string = "2h"
): string {
  return jwt.sign(
    { ...ownerPayload, impersonatedBy },
    getJwtSecret(),
    { expiresIn } as jwt.SignOptions
  );
}

export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Admin authentication required" });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as AdminAuthPayload;
    if (payload.type !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    // Back-fill role for tokens issued before role was added
    if (!payload.role) payload.role = "super_admin";
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

/**
 * Use on destructive routes (suspend, cancel, plan change).
 * finance_admin and support_admin are read-only; only super_admin may mutate.
 */
export function requireSuperAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  requireAdmin(req, res, () => {
    const role = req.admin?.role ?? "super_admin";
    if (role !== "super_admin") {
      return res.status(403).json({
        error: "This action requires super_admin privileges",
        yourRole: role,
      });
    }
    next();
  });
}
