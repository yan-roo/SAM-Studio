#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_SCRIPT="$ROOT_DIR/scripts/setup_backend.sh"
FRONTEND_SCRIPT="$ROOT_DIR/scripts/setup_frontend.sh"
ENV_SCRIPT="$ROOT_DIR/scripts/setup_env.sh"

backend_args=()
for arg in "$@"; do
  case "$arg" in
    --dev)
      backend_args+=("--dev")
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: scripts/setup_all.sh [--dev]" >&2
      exit 1
      ;;
  esac
done

"$BACKEND_SCRIPT" "${backend_args[@]}"
"$FRONTEND_SCRIPT"
"$ENV_SCRIPT"

echo
echo "All setup steps completed."
echo "Next:"
echo "- export HF_TOKEN=hf_xxx"
echo "- scripts/download_sam_audio_model.sh && scripts/setup_env.sh"
echo "- scripts/run_api.sh"
echo "- scripts/run_frontend.sh"

