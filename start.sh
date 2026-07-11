#!/bin/bash
export PATH="$PWD/node_modules/.bin:$PATH"

# Apply any pending database schema changes before starting servers.
# Uses db:push in development (fast, direct sync). In production, swap
# this for `pnpm db:migrate` to use the safe migration history path.
echo "[startup] Syncing database schema..."
pnpm db:push 2>&1 | tail -3
echo "[startup] Database ready."

# Start API server in background
pnpm --filter @workspace/api-server dev &
API_PID=$!

# Start frontend (blocks, shown in webview)
pnpm --filter @workspace/clean-track dev &
FRONTEND_PID=$!

# Wait for either to exit
wait $API_PID $FRONTEND_PID
