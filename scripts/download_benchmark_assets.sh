#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS_DIR="$ROOT_DIR/data/benchmarks/assets"
RAW_DIR="$ASSETS_DIR/raw"

SPEECH_URL="https://download.pytorch.org/torchaudio/tutorial-assets/Lab41-SRI-VOiCES-src-sp0307-ch127535-sg0042.wav"
WHISTLE_URL="https://download.pytorch.org/torchaudio/tutorial-assets/steam-train-whistle-daniel_simon.wav"
MUSIC_URL="https://upload.wikimedia.org/wikipedia/commons/1/1f/Sample2.ogg"

mkdir -p "$RAW_DIR"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required but not found on PATH." >&2
  exit 1
fi

download() {
  local url="$1"
  local dest="$2"
  if [[ -f "$dest" ]]; then
    echo "Using cached: $dest"
    return
  fi
  echo "Downloading: $url"
  curl -fsSL "$url" -o "$dest"
}

download "$SPEECH_URL" "$RAW_DIR/speech_voices.wav"
download "$WHISTLE_URL" "$RAW_DIR/whistle_train.wav"
download "$MUSIC_URL" "$RAW_DIR/music_sample2.ogg"

# Normalize to 16k mono, pad/trim to 20 seconds for consistent benchmarking.
ffmpeg -hide_banner -loglevel error -y \
  -i "$RAW_DIR/speech_voices.wav" \
  -ac 1 -ar 16000 -af "apad=pad_dur=20" -t 20 \
  "$ASSETS_DIR/speech_voices_20s_16k.wav"

ffmpeg -hide_banner -loglevel error -y \
  -i "$RAW_DIR/whistle_train.wav" \
  -ac 1 -ar 16000 -af "apad=pad_dur=20" -t 20 \
  "$ASSETS_DIR/whistle_train_20s_16k.wav"

ffmpeg -hide_banner -loglevel error -y \
  -i "$RAW_DIR/music_sample2.ogg" \
  -ac 1 -ar 16000 -af "apad=pad_dur=20" -t 20 \
  "$ASSETS_DIR/music_sample2_20s_16k.wav"

# A more discriminative mixture: speech + music.
ffmpeg -hide_banner -loglevel error -y \
  -i "$ASSETS_DIR/speech_voices_20s_16k.wav" \
  -i "$ASSETS_DIR/music_sample2_20s_16k.wav" \
  -filter_complex "[0:a]volume=1.0[a0];[1:a]volume=0.7[a1];[a0][a1]amix=inputs=2:duration=longest,volume=2[out]" \
  -map "[out]" \
  "$ASSETS_DIR/mix_speech_plus_music_20s_16k.wav"

echo
echo "Benchmark assets are ready under: $ASSETS_DIR"
echo "Suggested prompts:"
echo "- speech_voices_20s_16k.wav -> prompt: speech"
echo "- whistle_train_20s_16k.wav -> prompt: whistle / train whistle"
echo "- music_sample2_20s_16k.wav -> prompt: music"
echo "- mix_speech_plus_music_20s_16k.wav -> prompts: speech, music"
