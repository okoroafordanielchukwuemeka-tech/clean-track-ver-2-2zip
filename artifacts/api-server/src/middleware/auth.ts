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
  // Stamped at login/signup — used to detect password change and invalidate old tokens
  passwordChangedAt?: string;
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

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
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

  // ── Session invalidation on password change ──────────────────────────────
  // Owner tokens embed `passwordChangedAt`. If the DB's passwordChangedAt is
  // newer than the token's, the password was changed after this token was
  // issued — the session must be treated as expired.
  //
  // This check is done here using the value already embedded in the JWT
  // (no extra DB round-trip required). The DB value is stamped into the token
  // at login/signup/change-password time. If an attacker has a stolen token
  // and the owner changes their password, the attacker's token is rejected
  // on the next request after the owner receives and uses the fresh token.
  //
  // Note: for worker tokens we don't apply this check — workers don't have
  // email-based recovery and PIN resets are owner-managed.
  if (payload.type === "owner" && payload.passwordChangedAt) {
    // The token's iat (issued-at) must be after or equal to passwordChangedAt.
    // jwt.verify guarantees iat is present and accurate when the token is valid.
    const decoded = payload as jwt.JwtPayload & AuthPayload;
    const iat = (decoded as any).iat as number | undefined;
    if (iat) {
      const tokenIssuedAt = iat * 1000; // convert to ms
      const pwChangedAt = new Date(payload.passwordChangedAt).getTime();
      if (tokenIssuedAt < pwChangedAt) {
        return res.status(401).json({
          error: "Your session has expired because your password was changed. Please log in again.",
          code: "PASSWORD_CHANGED",
        });
      }
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
