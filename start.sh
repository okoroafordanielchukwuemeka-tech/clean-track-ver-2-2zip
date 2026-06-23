#!/bin/bash
export PATH="$PWD/node_modules/.bin:$PATH"

# Start API server in background
pnpm --filter @workspace/api-server dev &
API_PID=$!

# Start frontend (blocks, shown in webview)
pnpm --filter @workspace/clean-track dev &
FRONTEND_PID=$!

# Wait for either to exit
wait $API_PID $FRONTEND_PID
