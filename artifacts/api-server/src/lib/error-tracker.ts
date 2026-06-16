/**
 * Phase C — Production Error Tracker
 *
 * Captures backend exceptions with user context and persists them to
 * the error_log table for admin visibility. Never exposes raw stack
 * traces to clients.
 *
 * Usage:
 *   trackError(err, { requestId, laundryId, endpoint, method, statusCode })
 */

import { db } from "@workspace/db";
import { errorLog } from "@workspace/db/schema";
import { logError } from "./logger.js";

export interface ErrorContext {
  requestId?: string;
  laundryId?: number;
  userId?: number;
  userType?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  [key: string]: unknown;
}

export async function trackError(
  error: unknown,
  context: ErrorContext = {}
): Promise<void> {
  try {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    const stack = error instanceof Error ? error.stack : undefined;

    const { requestId, laundryId, endpoint, method, statusCode, ...rest } = context;

    await db.insert(errorLog).values({
      requestId,
      laundryId,
      severity: "error",
      message: message.slice(0, 2000),
      endpoint,
      method,
      statusCode,
      stack: stack?.slice(0, 5000),
      context: Object.keys(rest).length > 0 ? rest : {},
    });
  } catch (trackingErr) {
    logError("[error-tracker] Failed to persist error to DB:", trackingErr);
  }
}

export async function trackWarning(
  message: string,
  context: ErrorContext = {}
): Promise<void> {
  try {
    const { requestId, laundryId, endpoint, method, statusCode, ...rest } = context;

    await db.insert(errorLog).values({
      requestId,
      laundryId,
      severity: "warning",
      message: message.slice(0, 2000),
      endpoint,
      method,
      statusCode,
      context: Object.keys(rest).length > 0 ? rest : {},
    });
  } catch {
    // Tracking failures must never break the main request path
  }
}
