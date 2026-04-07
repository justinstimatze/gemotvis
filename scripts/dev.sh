#!/usr/bin/env bash
# Build frontend + Go binary and restart the demo server.
# Usage: ./scripts/dev.sh
set -e

cd "$(dirname "$0")/.."

# Kill existing server
kill -9 $(lsof -i :9090 -t 2>/dev/null) 2>/dev/null || true
sleep 1

# Build frontend (CSS/JS → internal/server/static/)
echo "→ Building frontend..."
(cd frontend && npm run build)

# Rebuild Go binary (embeds the new static files)
echo "→ Building Go..."
go build -o gemotvis .

# Start server
echo "→ Starting server..."
./gemotvis demo --cycle 0 &
sleep 1
echo "✓ Ready at http://localhost:9090"
