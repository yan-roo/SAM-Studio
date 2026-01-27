#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_PY="$ROOT_DIR/.venv/bin/python"

if [[ ! -x "$VENV_PY" ]]; then
  echo "Backend venv not found. Run: scripts/setup_backend.sh --dev" >&2
  exit 1
fi

cd "$ROOT_DIR"
exec "$VENV_PY" -m uvicorn app.api.main:app --reload --reload-dir app --port 8000

