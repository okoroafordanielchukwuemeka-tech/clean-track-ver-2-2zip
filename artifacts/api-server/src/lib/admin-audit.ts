import { db } from "@workspace/db";
import { adminAuditLog } from "@workspace/db/schema";
import type { AdminAuthPayload } from "../middleware/admin-auth.js";
import type { Request } from "express";

export interface LogAdminActionOptions {
  admin: AdminAuthPayload;
  action: string;
  targetLaundryId?: number;
  targetLaundryName?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
}

export async function logAdminAction(opts: LogAdminActionOptions): Promise<void> {
  try {
    const ip = opts.req
      ? ((opts.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? opts.req.socket.remoteAddress ?? null)
      : null;

    await db.insert(adminAuditLog).values({
      adminId: opts.admin.adminId,
      adminName: opts.admin.name,
      adminEmail: opts.admin.email,
      action: opts.action,
      targetLaundryId: opts.targetLaundryId ?? null,
      targetLaundryName: opts.targetLaundryName ?? null,
      metadata: (opts.metadata ?? null) as any,
      ipAddress: ip,
    });
  } catch (err) {
    console.error("[admin-audit] Failed to write audit log:", err);
  }
}
