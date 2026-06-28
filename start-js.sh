#!/bin/bash
# Start FastAPI backend + Next.js frontend for the JS version of the dashboard.
# Both run in the foreground via tmux, or run separately if tmux not available.

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Backend
echo "Starting FastAPI backend on :8000..."
cd app/backend
uvicorn main:app --port 8000 --reload &
BACKEND_PID=$!
cd "$ROOT"

# Frontend (needs Node >=20)
echo "Starting Next.js frontend on :3000..."
cd app/frontend
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20 2>/dev/null || true
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000/docs"
echo "  Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
