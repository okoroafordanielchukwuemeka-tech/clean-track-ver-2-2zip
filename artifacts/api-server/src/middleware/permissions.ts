import { Response, NextFunction } from "express";
import { AuthRequest, WorkerPermissions } from "./auth.js";

export type Permission =
  | "delete:customers"
  | "delete:orders"
  | "delete:payments"
  | "edit:customer-identity"
  | "modify:order-price"
  | "modify:order-items"
  | "apply:price-adjustment"
  | "approve:discount"
  | "view:orders"
  | "process:orders"
  | "record:payments"
  | "record:pickups"
  | "view:customers"
  | "create:customers"
  | "view:customer-balances"
  | "assign:orders"
  | "view:whatsapp"
  | "reply:whatsapp"
  | "manage:whatsapp";

const OWNER_ONLY = new Set<Permission>([
  "delete:customers",
  "delete:orders",
  "delete:payments",
  // edit:customer-identity is handled by canCreateCustomers — see WORKER_PERM_FIELD
  "modify:order-price",
  "modify:order-items",
  "apply:price-adjustment",
  "approve:discount",
]);

const WORKER_PERM_FIELD: Partial<Record<Permission, keyof WorkerPermissions>> = {
  "view:orders": "canViewOrders",
  "process:orders": "canProcessOrders",
  "record:payments": "canRecordPayments",
  "record:pickups": "canRecordPickups",
  "view:customers": "canViewCustomers",
  "create:customers": "canCreateCustomers",
  // Editing customer identity (name, phone, address) requires the same permission
  // as creating — if you can create customers you can also update them.
  "edit:customer-identity": "canCreateCustomers",
  "view:customer-balances": "canViewCustomerBalances",
  "assign:orders": "canAssignOrders",
  "view:whatsapp": "canViewWhatsApp",
  "reply:whatsapp": "canReplyWhatsApp",
  "manage:whatsapp": "canManageWhatsApp",
};

const PERM_HINT: Partial<Record<keyof WorkerPermissions, string>> = {
  canViewOrders: "view orders",
  canProcessOrders: "process orders",
  canRecordPayments: "record payments",
  canRecordPickups: "record pickups",
  canViewCustomers: "view customers",
  canCreateCustomers: "create customers",
  canViewCustomerBalances: "view customer balances",
  canAssignOrders: "assign orders",
  canViewWhatsApp: "view WhatsApp conversations",
  canReplyWhatsApp: "reply to WhatsApp conversations",
  canManageWhatsApp: "manage WhatsApp conversations",
};

export function checkPermission(permission: Permission) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (req.auth.type === "owner") {
      return next();
    }

    if (OWNER_ONLY.has(permission)) {
      return res.status(403).json({
        error: "Permission denied",
        required: permission,
        hint: "This action requires owner access",
      });
    }

    const field = WORKER_PERM_FIELD[permission];
    if (field) {
      const perms = req.auth.permissions;
      if (!perms || !perms[field]) {
        const action = PERM_HINT[field] ?? field;
        return res.status(403).json({
          error: "Permission denied",
          required: permission,
          hint: `You don't have permission to ${action}. Contact your manager to enable this.`,
        });
      }
    }

    next();
  };
}
