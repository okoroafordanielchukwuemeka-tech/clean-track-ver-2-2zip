/**
 * Client-side version constants — single source of truth.
 *
 * APP_VERSION   : bumped on every release; sent in X-Client-Version header
 *                 and in telemetry heartbeats.  Owners can see this per
 *                 device in Operations → Sync Health.
 *
 * SCHEMA_VERSION: IndexedDB / sync-queue payload schema version.  Stamped on
 *                 every SyncQueueEntry so the server can reject or downgrade
 *                 entries whose shape it no longer understands.  Must be
 *                 incremented whenever SyncQueueEntry payload shapes change.
 *
 * MIN_SUPPORTED_SERVER_VERSION: lowest server version this client can speak to.
 *                 If the server reports a version below this, the client shows
 *                 a warning (but does NOT block — graceful degradation).
 */

export const APP_VERSION = "1.1.0";
export const SCHEMA_VERSION = 2;
export const MIN_SUPPORTED_SERVER_VERSION = "1.0.0";
