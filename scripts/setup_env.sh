#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
ENV_FILE="$ROOT_DIR/.env"

force=0
hf_token_override=""
model_id_override=""

usage() {
  echo "Usage: scripts/setup_env.sh [--force] [--hf-token TOKEN] [--model-id MODEL_ID]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      force=1
      shift
      ;;
    --hf-token)
      hf_token_override="${2:-}"
      shift 2
      ;;
    --model-id)
      model_id_override="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "$ENV_EXAMPLE" ]]; then
  echo "Missing $ENV_EXAMPLE" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" && "$force" -ne 1 ]]; then
  echo "Updating existing .env (use --force to reset from .env.example)"
else
  cp "$ENV_EXAMPLE" "$ENV_FILE"
fi

update_kv() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  else
    printf "%s=%s\n" "$key" "$value" >>"$ENV_FILE"
  fi
}

# Ensure TFHub cache path exists and is wired up.
mkdir -p "$ROOT_DIR/data/cache/tfhub"
update_kv "TFHUB_CACHE_DIR" "data/cache/tfhub"

# Prefer an explicitly provided token, else use HF_TOKEN from the environment.
if [[ -n "$hf_token_override" ]]; then
  update_kv "HF_TOKEN" "$hf_token_override"
elif [[ -n "${HF_TOKEN:-}" ]]; then
  update_kv "HF_TOKEN" "$HF_TOKEN"
fi

# If a local model folder exists, prefer it by default.
current_model_id="$(grep '^MODEL_SAM_AUDIO_ID=' "$ENV_FILE" | cut -d= -f2- || true)"
if [[ -n "$model_id_override" ]]; then
  update_kv "MODEL_SAM_AUDIO_ID" "$model_id_override"
elif [[ -d "$ROOT_DIR/models/sam-audio-small" ]]; then
  if [[ "$force" -eq 1 || -z "$current_model_id" || "$current_model_id" == "facebook/sam-audio-small" ]]; then
    update_kv "MODEL_SAM_AUDIO_ID" "models/sam-audio-small"
  fi
fi

echo
echo "Wrote: $ENV_FILE"
echo "Key defaults applied:"
echo "- TFHUB_CACHE_DIR=data/cache/tfhub"
if [[ -d "$ROOT_DIR/models/sam-audio-small" || -n "$model_id_override" ]]; then
  echo "- MODEL_SAM_AUDIO_ID=$(grep '^MODEL_SAM_AUDIO_ID=' "$ENV_FILE" | cut -d= -f2-)"
fi
if grep -q '^HF_TOKEN=' "$ENV_FILE"; then
  token_val="$(grep '^HF_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
  if [[ -n "$token_val" ]]; then
    echo "- HF_TOKEN is set"
  else
    echo "- HF_TOKEN is empty"
  fi
fi
