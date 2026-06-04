/**
 * Server-side version constants.
 *
 * SERVER_VERSION   : current API server version; sent as X-Server-Version
 *                    on every response.
 *
 * MIN_CLIENT_VERSION: oldest client version this server accepts.  Sent as
 *                    X-Min-Client-Version on every response so clients can
 *                    self-detect when they are running an unsupported build.
 *                    Clients older than this will show a persistent banner
 *                    prompting the user to reload.
 */

export const SERVER_VERSION = "1.1.0";
export const MIN_CLIENT_VERSION = "1.0.0";
