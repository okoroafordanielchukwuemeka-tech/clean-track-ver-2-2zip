import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface WorkerPermissions {
  canViewOrders: boolean;
  canProcessOrders: boolean;
  canRecordPayments: boolean;
  canRecordPickups: boolean;
  canViewCustomers: boolean;
  canCreateCustomers: boolean;
  canViewCustomerBalances: boolean;
  canAssignOrders: boolean;
}

export interface AuthPayload {
  laundryId: number;
  type: "owner" | "worker";
  ownerId?: number;
  workerId?: number;
  workerRole?: "admin" | "worker";
  branchId?: number;
  email?: string;
  name?: string;
  permissions?: WorkerPermissions;
}

export interface AuthRequest extends Request {
  auth?: AuthPayload;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // This should never be reached in production — env-validation.ts crashes
    // the process before any request is served. This guard is a last resort.
    throw new Error(
      "FATAL: JWT_SECRET environment variable is not set. Server cannot authenticate requests."
    );
  }
  return secret;
}

export function signToken(payload: AuthPayload, expiresIn: string = "7d"): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn } as jwt.SignOptions);
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireOwner(req: AuthRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.auth?.type !== "owner") {
      return res.status(403).json({ error: "Owner access required" });
    }
    next();
  });
}

export function requireWorkerOrOwner(req: AuthRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.auth) {
      return res.status(401).json({ error: "Authentication required" });
    }
    next();
  });
}
