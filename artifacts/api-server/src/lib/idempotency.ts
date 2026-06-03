import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { idempotencyKeys, type IdempotencyKey } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Express middleware that provides idempotency protection for mutating routes.
 *
 * Protocol (atomic reservation pattern — eliminates the check→process→insert
 * race window that allowed duplicate handler execution under concurrent retries):
 *
 *  1. Attempt to INSERT a 'pending' row for the key (ON CONFLICT DO NOTHING).
 *     - If the INSERT returns the row  → this request is the first; proceed.
 *     - If the INSERT returns nothing  → key already exists; inspect its state.
 *       • status='completed'          → return the cached response immediately.
 *       • status='pending'            → a concurrent request is mid-flight;
 *                                       return 409 so the client retries shortly.
 *
 *  2. Override res.json so that on a successful (2xx) response the pending row
 *     is promoted to 'completed' (status + body + status_code) BEFORE the
 *     response is flushed to the client.
 *
 *  3. On any non-2xx response (handler error) the pending row is deleted so
 *     that the client can safely retry without getting a permanent 409.
 *
 *  4. DB errors fall open — if we cannot talk to the DB we let the request
 *     through rather than blocking legitimate traffic.
 *
 * Key source: SyncQueueEntry.clientId (UUID, generated once at enqueue time,
 * persisted in IndexedDB). It survives refresh, restart, and recovery.
 */
export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = (req.headers["idempotency-key"] as string | undefined)?.trim();

  if (!key) {
    next();
    return;
  }

  const cutoff = new Date(Date.now() - TTL_MS);

  // ── Step 1: atomic reservation ───────────────────────────────────────────
  db.insert(idempotencyKeys)
    .values({ key, status: "pending", statusCode: 0, responseBody: null })
    .onConflictDoNothing()
    .returning()
    .then(async (inserted: IdempotencyKey[]) => {
      if (inserted.length > 0) {
        // We claimed the key — this is the first request. Attach the
        // response interceptor and hand off to the handler.
        attachResponseInterceptor(res, key);
        next();
        return;
      }

      // Key already exists — inspect its current state.
      const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.key, key), gt(idempotencyKeys.createdAt, cutoff)));

      if (!existing) {
        // Row expired or was deleted between our INSERT and SELECT — treat as
        // a new request (extremely rare edge case; safe to proceed).
        attachResponseInterceptor(res, key);
        next();
        return;
      }

      if (existing.status === "completed" && existing.responseBody) {
        // Cached success — replay it without touching the handler.
        res.status(existing.statusCode).json(JSON.parse(existing.responseBody));
        return;
      }

      // status='pending': a concurrent request is still processing this key.
      // Return 409 so the client knows to retry in a moment.
      res.status(409).json({
        error: "Request already in progress. Retry after a moment.",
        code: "IDEMPOTENCY_IN_FLIGHT",
      });
    })
    .catch((err: unknown) => {
      console.error("[Idempotency] DB error — proceeding without protection:", err);
      next();
    });
}

function attachResponseInterceptor(res: Response, key: string): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: unknown) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // Promote to 'completed' BEFORE flushing the response.
      return db
        .update(idempotencyKeys)
        .set({
          status: "completed",
          statusCode: res.statusCode,
          responseBody: JSON.stringify(body),
        })
        .where(eq(idempotencyKeys.key, key))
        .then(() => originalJson(body))
        .catch((err: unknown) => {
          console.error("[Idempotency] Failed to cache response:", err);
          return originalJson(body);
        }) as unknown as Response;
    }

    // Non-2xx: delete the pending row so the client can retry cleanly.
    db.delete(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .catch((err: unknown) => {
        console.error("[Idempotency] Failed to delete pending key:", err);
      });

    return originalJson(body);
  };
}
