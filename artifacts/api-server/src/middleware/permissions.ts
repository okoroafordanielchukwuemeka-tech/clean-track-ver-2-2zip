import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";

export type Permission =
  | "delete:customers"
  | "delete:orders"
  | "delete:payments"
  | "edit:customer-identity"
  | "modify:order-price"
  | "modify:order-items"
  | "apply:price-adjustment"
  | "approve:discount";

const OWNER_ONLY = new Set<Permission>([
  "delete:customers",
  "delete:orders",
  "delete:payments",
  "edit:customer-identity",
  "modify:order-price",
  "modify:order-items",
  "apply:price-adjustment",
  "approve:discount",
]);

export function checkPermission(permission: Permission) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (OWNER_ONLY.has(permission) && req.auth.type !== "owner") {
      return res.status(403).json({
        error: "Permission denied",
        required: permission,
        hint: "This action requires owner access",
      });
    }
    next();
  };
}
