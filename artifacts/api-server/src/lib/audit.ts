import { db } from "@workspace/db";
import { auditLog } from "@workspace/db/schema";
import { AuthPayload } from "../middleware/auth.js";

interface AuditParams {
  auth: AuthPayload;
  laundryId: number;
  action: string;
  orderId?: number;
  metadata?: Record<string, unknown>;
}

export async function logAction({ auth, laundryId, action, orderId, metadata }: AuditParams): Promise<void> {
  try {
    await db.insert(auditLog).values({
      laundryId,
      actorId: auth.type === "owner" ? (auth.ownerId ?? null) : (auth.workerId ?? null),
      actorType: auth.type,
      actorName: auth.name ?? auth.email ?? "unknown",
      action,
      orderId: orderId ?? null,
      metadata: metadata ?? {},
    });
  } catch {
  }
}

export function actorName(auth: AuthPayload): string {
  return auth.name ?? auth.email ?? "unknown";
}
