/**
 * Phase D — Structured Logger
 *
 * Provides INFO / WARN / ERROR levels with timestamps, request IDs,
 * and optional user/laundry context. Outputs JSON in production,
 * human-readable in development.
 */

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface LogContext {
  requestId?: string;
  laundryId?: number;
  userId?: number;
  userType?: string;
  endpoint?: string;
  method?: string;
  durationMs?: number;
  statusCode?: number;
  [key: string]: unknown;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const ts = new Date().toISOString();
  if (IS_PRODUCTION) {
    return JSON.stringify({ ts, level, message, ...context });
  }
  const ctx = context
    ? " " + Object.entries(context)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ")
    : "";
  return `[${ts}] ${level.padEnd(5)} ${message}${ctx}`;
}

export function log(message: string, context?: LogContext): void {
  console.log(formatLog("INFO", message, context));
}

export function warn(message: string, context?: LogContext): void {
  console.warn(formatLog("WARN", message, context));
}

export function logError(message: string, error?: unknown, context?: LogContext): void {
  const extra: LogContext = { ...context };
  if (error instanceof Error) {
    extra.errorMessage = error.message;
    extra.stack = error.stack;
  } else if (error !== undefined) {
    extra.error = String(error);
  }
  console.error(formatLog("ERROR", message, extra));
}

export function makeRequestLogger() {
  return function requestLogger(
    req: { method: string; path: string; requestId?: string; auth?: { laundryId?: number; type?: string; ownerId?: number; workerId?: number } },
    res: { statusCode: number; on: (event: string, cb: () => void) => void },
    next: () => void
  ) {
    const start = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const ctx: LogContext = {
        requestId: req.requestId,
        method: req.method,
        endpoint: req.path,
        statusCode: res.statusCode,
        durationMs,
      };
      if (req.auth) {
        ctx.laundryId = req.auth.laundryId;
        ctx.userType = req.auth.type;
      }
      const level: LogLevel = res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO";
      const msg = `${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`;
      if (level === "ERROR") console.error(formatLog(level, msg, ctx));
      else if (level === "WARN") console.warn(formatLog(level, msg, ctx));
      else console.log(formatLog(level, msg, ctx));
    });
    next();
  };
}
