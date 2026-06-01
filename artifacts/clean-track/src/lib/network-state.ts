/**
 * Shared module-level network state — Phase 3A.5
 *
 * Provides a non-React source of truth for online/offline status so that
 * mutation functions (which run outside the React render cycle) use the same
 * ground-truth value as NetworkStatusBadge.
 *
 * Updated by two independent sources:
 *  1. Browser `online`/`offline` events — fires immediately on change.
 *  2. Active HEAD /api/healthz probe inside use-network-status.ts — catches
 *     captive portals and mobile networks where navigator.onLine lies.
 *
 * Mutation functions call getIsOnline() instead of navigator.onLine.
 */

let _isOnline: boolean =
  typeof navigator !== "undefined" ? navigator.onLine : true;

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    _isOnline = true;
  });
  window.addEventListener("offline", () => {
    _isOnline = false;
  });
}

/** Returns the current best-known online status. */
export function getIsOnline(): boolean {
  return _isOnline;
}

/**
 * Called by use-network-status.ts after each HEAD probe completes.
 * Keeps the shared state in sync with ground-truth connectivity.
 */
export function setIsOnline(val: boolean): void {
  _isOnline = val;
}
