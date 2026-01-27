#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js 18+." >&2
  exit 1
fi

echo "Installing frontend dependencies"
cd "$FRONTEND_DIR"
npm install

echo
echo "Frontend setup complete."
echo "Use: scripts/run_frontend.sh"

