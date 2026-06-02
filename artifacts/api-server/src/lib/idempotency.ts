import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { idempotencyKeys, type IdempotencyKey } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Express middleware that provides idempotency protection for mutating routes.
 *
 * Usage: add as a middleware on any POST/PATCH route that should be protected.
 *   router.post("/", idempotencyMiddleware, handler)
 *
 * Protocol:
 *   - Client sends `Idempotency-Key: <uuid>` header with every sync request.
 *   - On first receipt of a key, the middleware proceeds and caches the
 *     successful (2xx) response body + status code in the DB.
 *   - On subsequent receipts of the same key (within 24 h), the middleware
 *     returns the cached response immediately — the handler is never called.
 *   - Failed responses (4xx, 5xx) are never cached; retries are allowed.
 *   - If the DB lookup itself fails, the middleware falls through to the handler
 *     (fail-open) so legitimate traffic is never blocked by a DB error.
 *
 * Key source: the SyncQueueEntry.clientId (a UUID generated once at enqueue
 * time and persisted in IndexedDB). It survives refresh, restart, and recovery.
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

  db.select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), gt(idempotencyKeys.createdAt, cutoff)))
    .then(([existing]: [IdempotencyKey | undefined]) => {
      if (existing) {
        res.status(existing.statusCode).json(JSON.parse(existing.responseBody));
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          db.insert(idempotencyKeys)
            .values({
              key,
              statusCode: res.statusCode,
              responseBody: JSON.stringify(body),
            })
            .onConflictDoNothing()
            .catch((err: unknown) =>
              console.error("[Idempotency] Failed to cache response:", err)
            );
        }
        return originalJson(body);
      };

      next();
    })
    .catch((err: unknown) => {
      console.error("[Idempotency] DB lookup failed — proceeding without protection:", err);
      next();
    });
}
