import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  laundryId: number;
  type: "owner" | "worker";
  ownerId?: number;
  workerId?: number;
  workerRole?: "admin" | "worker";
  email?: string;
  name?: string;
}

export interface AuthRequest extends Request {
  auth?: AuthPayload;
}

const JWT_SECRET = process.env.JWT_SECRET || "clean-track-dev-secret-change-in-production";

export function signToken(payload: AuthPayload, expiresIn: string = "7d"): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
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
