#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Frontend dependencies not installed. Run: scripts/setup_frontend.sh" >&2
  exit 1
fi

cd "$FRONTEND_DIR"
exec npm run dev

