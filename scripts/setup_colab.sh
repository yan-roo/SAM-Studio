#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

download_model=0
download_assets=0
yamnet=1
device_override=""
hf_token_override=""

usage() {
  cat >&2 <<'EOF'
Usage: scripts/setup_colab.sh [options]

Options:
  --hf-token TOKEN       Hugging Face token used for model download + .env.
  --device DEVICE        Force SAM_AUDIO_DEVICE in .env (e.g. cuda|mps|cpu|auto).
  --download-model       Download SAM-Audio weights into models/sam-audio-small.
  --download-assets      Download benchmark assets.
  --no-yamnet            Skip tensorflow / tensorflow-hub install.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hf-token)
      hf_token_override="${2:-}"
      shift 2
      ;;
    --device)
      device_override="${2:-}"
      shift 2
      ;;
    --download-model)
      download_model=1
      shift
      ;;
    --download-assets)
      download_assets=1
      shift
      ;;
    --no-yamnet)
      yamnet=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

echo "==> Installing system packages (ffmpeg, libsndfile1)"
apt-get -y update >/dev/null
apt-get -y install ffmpeg libsndfile1 >/dev/null

echo "==> Upgrading pip"
python -m pip install -U pip >/dev/null

echo "==> Installing Python dependencies (without reinstalling torch)"
python -m pip install \
  fastapi "uvicorn[standard]" numpy soundfile python-multipart python-dotenv \
  "huggingface_hub<1,>=0.23.0" safetensors "transformers<5,>=4.54.0" \
  einops scipy >/dev/null

echo "==> Verifying torch / torchaudio"
if python - <<'PY' >/dev/null 2>&1
import torch  # noqa: F401
import torchaudio  # noqa: F401
PY
then
  torch_version="$(python - <<'PY'
import torch
print(torch.__version__)
PY
)"
  torchaudio_version="$(python - <<'PY'
import torchaudio
print(torchaudio.__version__)
PY
)"
  echo "    torch=$torch_version torchaudio=$torchaudio_version"
else
  if ! python - <<'PY' >/dev/null 2>&1
import torch  # noqa: F401
PY
  then
    echo "torch is not available. In Colab, switch to a GPU runtime first." >&2
    exit 1
  fi
  torch_base_version="$(python - <<'PY'
import torch
print(torch.__version__.split("+")[0])
PY
)"
  echo "    torchaudio not found. Installing torchaudio==$torch_base_version (no-deps)"
  python -m pip install --no-deps "torchaudio==$torch_base_version" >/dev/null
  if ! python - <<'PY' >/dev/null 2>&1
import torchaudio  # noqa: F401
PY
  then
    echo "torchaudio still not importable. Try restarting the runtime and re-running setup." >&2
    exit 1
  fi
fi

if [[ "$yamnet" -eq 1 ]]; then
  echo "==> Installing YAMNet dependencies (tensorflow, tensorflow-hub)"
  python -m pip install tensorflow tensorflow-hub >/dev/null
else
  echo "==> Skipping YAMNet dependencies (--no-yamnet)"
fi

echo "==> Installing SAM-Audio extras (no-deps to avoid torch override)"
python -m pip install --no-deps timm torchcodec torchdiffeq >/dev/null
python -m pip install --no-deps git+https://github.com/facebookresearch/sam-audio.git >/dev/null
python -m pip install --no-deps git+https://github.com/facebookresearch/perception_models@unpin-deps >/dev/null
python -m pip install --no-deps git+https://github.com/facebookresearch/dacvae.git >/dev/null

if [[ -n "$hf_token_override" ]]; then
  export HF_TOKEN="$hf_token_override"
fi

echo "==> Creating/updating .env"
scripts/setup_env.sh --force ${HF_TOKEN:+--hf-token "$HF_TOKEN"} >/dev/null

update_kv() {
  local key="$1"
  local value="$2"
  local env_file="$ROOT_DIR/.env"
  if grep -q "^${key}=" "$env_file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$env_file"
    rm -f "$env_file.bak"
  else
    printf "%s=%s\n" "$key" "$value" >>"$env_file"
  fi
}

if [[ -n "$device_override" ]]; then
  echo "==> Forcing SAM_AUDIO_DEVICE=$device_override"
  update_kv "SAM_AUDIO_DEVICE" "$device_override"
fi

if [[ "$download_model" -eq 1 ]]; then
  if [[ -z "${HF_TOKEN:-}" ]]; then
    echo "HF_TOKEN is required for --download-model" >&2
    echo "Use: scripts/setup_colab.sh --hf-token hf_xxx --download-model" >&2
    exit 1
  fi
  echo "==> Downloading SAM-Audio model weights"
  HF_TOKEN="$HF_TOKEN" scripts/download_sam_audio_model.sh >/dev/null
  # Re-apply env defaults so MODEL_SAM_AUDIO_ID points at the local folder.
  scripts/setup_env.sh ${HF_TOKEN:+--hf-token "$HF_TOKEN"} >/dev/null
fi

if [[ "$download_assets" -eq 1 ]]; then
  echo "==> Downloading benchmark assets"
  scripts/download_benchmark_assets.sh >/dev/null
fi

echo
echo "Colab setup complete."
echo
echo "Suggested benchmark command:"
echo "  SAM_AUDIO_DEVICE=cuda python scripts/benchmark_sam_audio.py --preview-seconds 20 --warmup 1 --repeats 3"
