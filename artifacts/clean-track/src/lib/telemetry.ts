/**
 * Sync Telemetry — Phase: Sync Health Visibility
 *
 * Sends a lightweight heartbeat to the server every 30 seconds so owners can
 * monitor worker device sync health from the Operations Center.
 *
 * Design constraints:
 *  - Zero modifications to sync-engine.ts, queue-service.ts, or recovery.ts
 *  - Read-only access to local state (syncEngine, localDb)
 *  - All errors are swallowed — telemetry must NEVER affect the core app
 *  - Heartbeat fires on online/offline transitions in addition to the timer
 */

import { syncEngine } from "./sync-engine";
import { localDb, getMetadata } from "./local-db";
import { api } from "./api";

const DEVICE_ID_KEY = "ct_device_id";
const TOKEN_KEY = "ct_token";
export const APP_VERSION = "1.0.0";
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Returns the stable device UUID for this browser profile.
 * Created once on first load and stored in localStorage.
 */
export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Reads current sync state from the engine and IndexedDB, then POSTs to
 * /api/telemetry/heartbeat. No-ops silently when not authenticated.
 */
async function sendHeartbeat(): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  const deviceId = getOrCreateDeviceId();
  const state = syncEngine.getState();

  const conflictCount = await localDb.syncQueue
    .where("status")
    .equals("failed")
    .filter((e) => (e.lastError ?? "").startsWith("CONFLICT:"))
    .count();

  const recoveryCount = Number((await getMetadata("ct_recovery_count")) ?? 0);

  await api.telemetry.heartbeat({
    deviceId,
    pendingCount: state.pendingCount,
    failedCount: state.failedCount,
    conflictCount,
    recoveryCount,
    isOnline: state.isOnline,
    appVersion: APP_VERSION,
    lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
  });
}

function scheduledBeat(): void {
  sendHeartbeat().catch(() => {});
}

let _started = false;

/**
 * Call once at app startup (after recovery). Sets up the 30-second interval
 * and online/offline event listeners. Safe to call multiple times — only the
 * first call takes effect.
 */
export function initTelemetry(): void {
  if (_started) return;
  _started = true;

  scheduledBeat();
  setInterval(scheduledBeat, HEARTBEAT_INTERVAL_MS);
  window.addEventListener("online", scheduledBeat);
  window.addEventListener("offline", scheduledBeat);
}
