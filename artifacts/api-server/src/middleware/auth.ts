import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { workers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

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
  // Stamped at login/signup — used to detect password change and invalidate old tokens
  passwordChangedAt?: string;
  // Stamped at worker login — informational; actual invalidation uses DB lookup
  pinChangedAt?: string;
}

export interface AuthRequest extends Request {
  auth?: AuthPayload;
  requestId?: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "FATAL: JWT_SECRET environment variable is not set. Server cannot authenticate requests."
    );
  }
  return secret;
}

export function signToken(payload: AuthPayload, expiresIn: string = "7d"): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn } as jwt.SignOptions);
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const token = authHeader.slice(7);

  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, getJwtSecret()) as AuthPayload;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const decoded = payload as jwt.JwtPayload & AuthPayload;
  const iat = (decoded as any).iat as number | undefined;

  // ── Owner: session invalidation on password change ────────────────────────
  // The token embeds `passwordChangedAt` (from DB at login time). When the
  // owner changes their password, the new token carries the new timestamp.
  // The middleware checks that the token was issued after the last password
  // change — if not, the session is expired.
  if (payload.type === "owner" && payload.passwordChangedAt) {
    if (iat) {
      const tokenIssuedAt = iat * 1000;
      const pwChangedAt = new Date(payload.passwordChangedAt).getTime();
      if (tokenIssuedAt < pwChangedAt) {
        return res.status(401).json({
          error: "Your session has expired because your password was changed. Please log in again.",
          code: "PASSWORD_CHANGED",
        });
      }
    }
  }

  // ── Worker: session invalidation on PIN change (DB lookup) ────────────────
  // The JWT embeds pinChangedAt at login time, so comparing iat against the
  // JWT value is circular (iat is always >= pinChangedAt at login). Instead,
  // fetch the CURRENT pinChangedAt from the DB and compare against iat.
  // This correctly rejects tokens issued before the most recent PIN reset.
  //
  // Workers without pinChangedAt (pre-migration rows, null in DB) are allowed
  // through — no forced re-login after the schema migration.
  if (payload.type === "worker" && payload.workerId && iat) {
    try {
      const [row] = await db
        .select({ pinChangedAt: workers.pinChangedAt })
        .from(workers)
        .where(eq(workers.id, payload.workerId));

      if (row?.pinChangedAt) {
        const tokenIssuedAt = iat * 1000;
        const pinChangedAt = row.pinChangedAt.getTime();
        if (tokenIssuedAt < pinChangedAt) {
          return res.status(401).json({
            error: "Your session has expired because your PIN was changed. Please log in again.",
            code: "PIN_CHANGED",
          });
        }
      }
    } catch {
      // DB lookup failure: fail open to preserve availability.
      // A network blip should not log out all active workers.
    }
  }

  req.auth = payload;
  next();
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
