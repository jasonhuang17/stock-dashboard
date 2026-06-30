#!/bin/bash
# Start FastAPI backend + Next.js frontend for the JS version of the dashboard.
# Set PUBLIC_HOST=100.x.y.z when accessing from another device (for example via Tailscale).

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

HOST="${HOST:-0.0.0.0}"
PUBLIC_HOST="${PUBLIC_HOST:-}"

if [ -z "$PUBLIC_HOST" ] && command -v tailscale >/dev/null 2>&1; then
  PUBLIC_HOST="$(tailscale ip -4 2>/dev/null | head -n 1)"
fi

API_HOST="${API_HOST:-${PUBLIC_HOST:-localhost}}"
FRONTEND_HOST="${FRONTEND_HOST:-${PUBLIC_HOST:-localhost}}"
export PUBLIC_HOST
export API_HOST
export FRONTEND_HOST
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://${API_HOST}:8000}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://${FRONTEND_HOST}:3000}"

if [ -z "$PUBLIC_HOST" ]; then
  echo "Warning: PUBLIC_HOST is empty; remote devices may not load API data."
  echo "         Use PUBLIC_HOST=100.x.y.z ./start-js.sh for Tailscale/iPhone access."
fi

# Backend
echo "Starting FastAPI backend on ${HOST}:8000..."
cd js/backend
uvicorn main:app --host "$HOST" --port 8000 --reload &
BACKEND_PID=$!
cd "$ROOT"

# Frontend (needs Node >=20)
echo "Starting Next.js frontend on ${HOST}:3000..."
cd js/frontend
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20 2>/dev/null || true
npm run dev -- --hostname "$HOST" &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000/docs"
echo "  Frontend: http://localhost:3000"
if [ -n "$PUBLIC_HOST" ]; then
  echo "  Remote:   http://${PUBLIC_HOST}:3000"
  echo "  API URL:  ${NEXT_PUBLIC_API_URL}"
fi
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
