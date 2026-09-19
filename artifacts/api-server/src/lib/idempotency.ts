import { Request, Response, NextFunction } from "express";
type AuthRequestLike = Request & { auth?: { laundryId?: number } };
import { db } from "@workspace/db";
import { idempotencyKeys, type IdempotencyKey } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Express middleware that provides idempotency protection for mutating routes.
 *
 * Protocol (atomic reservation pattern):
 *  1. Reserve the key with INSERT ... ON CONFLICT DO NOTHING.
 *  2. First request proceeds; concurrent requests receive 409 while pending.
 *  3. Successful 2xx responses are cached before being flushed to the client.
 *  4. Non-2xx responses release the reservation so the client can retry.
 *  5. DB errors fail open rather than blocking legitimate traffic.
 *
 * The response interceptor handles both res.json() and res.send(). This is
 * important for DELETE endpoints that correctly return HTTP 204: those routes
 * bypass res.json(), so intercepting only json() would leave their idempotency
 * row stuck in 'pending' forever and every retry would receive 409.
 */
export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const clientKey = (req.headers["idempotency-key"] as string | undefined)?.trim();

  if (!clientKey) {
    next();
    return;
  }

  const laundryId = (req as AuthRequestLike).auth?.laundryId ?? "anonymous";
  const key = `${laundryId}:${req.method}:${req.baseUrl}${req.path}:${clientKey}`;
  const cutoff = new Date(Date.now() - TTL_MS);

  db.delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), gt(cutoff, idempotencyKeys.createdAt)))
    .then(() => db.insert(idempotencyKeys)
      .values({ key, status: "pending", statusCode: 0, responseBody: null })
    .onConflictDoNothing()
      .returning())
    .then(async (inserted: IdempotencyKey[]) => {
      if (inserted.length > 0) {
        attachResponseInterceptor(res, key);
        next();
        return;
      }

      const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.key, key), gt(idempotencyKeys.createdAt, cutoff)));

      if (!existing) {
        attachResponseInterceptor(res, key);
        next();
        return;
      }

      if (existing.status === "completed") {
        // JSON responses have a cached body. A 204 response deliberately has
        // no body, so replay the status with an empty response instead.
        if (existing.responseBody) {
          res.status(existing.statusCode).json(JSON.parse(existing.responseBody));
        } else {
          res.status(existing.statusCode).send();
        }
        return;
      }

      res.status(409).json({
        error: "Request already in progress. Retry after a moment.",
        code: "IDEMPOTENCY_IN_FLIGHT",
      });
    })
    .catch((err: unknown) => {
      console.error("[Idempotency] DB error:", err);
      res.status(503).json({ error: "Idempotency service temporarily unavailable. Please retry." });
    });
}

function attachResponseInterceptor(res: Response, key: string): void {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  const cacheSuccess = (body: unknown, flush: () => Response): Response => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return db
        .update(idempotencyKeys)
        .set({
          status: "completed",
          statusCode: res.statusCode,
          responseBody: body === undefined || res.statusCode === 204 ? null : JSON.stringify(body),
        })
        .where(eq(idempotencyKeys.key, key))
        .then(() => flush())
        .catch((err: unknown) => {
          console.error("[Idempotency] Failed to cache response:", err);
          return flush();
        }) as unknown as Response;
    }

    db.delete(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .catch((err: unknown) => {
        console.error("[Idempotency] Failed to delete pending key:", err);
      });

    return flush();
  };

  res.json = function (body: unknown) {
    return cacheSuccess(body, () => originalJson(body));
  };

  res.send = function (body?: any) {
    return cacheSuccess(body, () => originalSend(body));
  };
}
