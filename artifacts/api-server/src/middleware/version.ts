import { Request, Response, NextFunction } from "express";
import { SERVER_VERSION, MIN_CLIENT_VERSION } from "../lib/version.js";

/**
 * Version middleware — runs on every API response.
 *
 * Attaches two response headers:
 *   X-Server-Version     : the current API version (e.g. "1.1.0")
 *   X-Min-Client-Version : oldest client this server accepts (e.g. "1.0.0")
 *
 * Attaches to the request object (for route use / logging):
 *   req.clientVersion    : value of the incoming X-Client-Version header, or null
 *   req.clientIsOutdated : true when the client is older than MIN_CLIENT_VERSION
 *
 * IMPORTANT: this middleware never blocks a request — it only annotates.
 * Outdated clients receive a 200 response with warning headers so they can
 * continue operating offline and display a graceful "please update" banner.
 */

declare global {
  namespace Express {
    interface Request {
      clientVersion: string | null;
      clientIsOutdated: boolean;
    }
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function versionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const clientVersion =
    typeof req.headers["x-client-version"] === "string"
      ? req.headers["x-client-version"].trim()
      : null;

  req.clientVersion = clientVersion;
  req.clientIsOutdated =
    clientVersion != null &&
    compareVersions(clientVersion, MIN_CLIENT_VERSION) < 0;

  res.setHeader("X-Server-Version", SERVER_VERSION);
  res.setHeader("X-Min-Client-Version", MIN_CLIENT_VERSION);

  if (req.clientIsOutdated) {
    res.setHeader("X-Version-Warning", "client-outdated");
  }

  next();
}
