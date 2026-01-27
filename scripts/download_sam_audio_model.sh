#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$ROOT_DIR/models/sam-audio-small"

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "HF_TOKEN is not set. Export it first." >&2
  echo "Example: export HF_TOKEN=hf_xxx" >&2
  exit 1
fi

mkdir -p "$MODEL_DIR"

echo "Downloading SAM-Audio model files to $MODEL_DIR"
curl -L -H "Authorization: Bearer $HF_TOKEN" \
  -o "$MODEL_DIR/config.json" \
  https://huggingface.co/facebook/sam-audio-small/resolve/main/config.json
curl -L -H "Authorization: Bearer $HF_TOKEN" \
  -o "$MODEL_DIR/checkpoint.pt" \
  https://huggingface.co/facebook/sam-audio-small/resolve/main/checkpoint.pt

echo
echo "Model download complete."
echo "Set: export MODEL_SAM_AUDIO_ID=models/sam-audio-small"

