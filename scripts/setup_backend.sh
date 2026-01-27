#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3.11}"

install_dev=0
for arg in "$@"; do
  case "$arg" in
    --dev)
      install_dev=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: scripts/setup_backend.sh [--dev]" >&2
      exit 1
      ;;
  esac
done

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "python3.11 not found. Install Python 3.11 or set PYTHON_BIN." >&2
  exit 1
fi

echo "Creating venv at $VENV_DIR"
"$PYTHON_BIN" -m venv "$VENV_DIR"

echo "Upgrading pip"
"$VENV_DIR/bin/python" -m pip install --upgrade pip

echo "Installing Python dependencies"
"$VENV_DIR/bin/pip" install -r "$ROOT_DIR/requirements.txt"

if [[ "$install_dev" -eq 1 ]]; then
  echo "Installing dev dependencies"
  "$VENV_DIR/bin/pip" install -r "$ROOT_DIR/requirements-dev.txt"
fi

echo "Installing SAM-Audio git packages (no-deps)"
"$VENV_DIR/bin/pip" install --no-deps git+https://github.com/facebookresearch/sam-audio.git
"$VENV_DIR/bin/pip" install --no-deps git+https://github.com/facebookresearch/perception_models@unpin-deps
"$VENV_DIR/bin/pip" install --no-deps git+https://github.com/facebookresearch/dacvae.git

echo
echo "Backend setup complete."
echo "Use: scripts/run_api.sh"
