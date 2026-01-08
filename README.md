# SAM-Studio

Promptable audio selection and mix demo built on SAM-Audio.

## Prerequisites

- Python 3.11 only (venv recommended; SAM-Audio does not install on 3.13 due to `decord`)
- SAM-Audio model dependencies (see install steps below)
- Node.js 18+ and npm
- `ffmpeg` for mp3/m4a/mp4 uploads
- `libsndfile` for `soundfile`

Example installs:

```bash
brew install ffmpeg libsndfile
# or on Ubuntu/Debian:
# sudo apt-get install ffmpeg libsndfile1
```

## Backend setup

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt
```

Required (torch/torchaudio, required for SAM-Audio):

```bash
pip install -r requirements-separation.txt
```

Required (SAM-Audio text prompting):

```bash
pip install -r requirements-sam-audio.txt
```

Optional (YAMNet candidates):

```bash
pip install -r requirements-yamnet.txt
```

SAM-Audio requires Hugging Face access to `facebook/sam-audio-small` (set `HF_TOKEN`).

### Manual model downloads (curl)

You can download the SAM-Audio weights without `huggingface-cli` as long as your token has access.

```bash
mkdir -p models/sam-audio-small
curl -L -H "Authorization: Bearer $HF_TOKEN" \
  -o models/sam-audio-small/config.json \
  https://huggingface.co/facebook/sam-audio-small/resolve/main/config.json
curl -L -H "Authorization: Bearer $HF_TOKEN" \
  -o models/sam-audio-small/checkpoint.pt \
  https://huggingface.co/facebook/sam-audio-small/resolve/main/checkpoint.pt
```

Set `MODEL_SAM_AUDIO_ID=models/sam-audio-small` (the `models/` folder is gitignored).

## Quick start (dev)

```bash
uvicorn app.api.main:app --reload --reload-dir app --port 8000

cd frontend
npm install
npm run dev
```

## Frontend setup

```bash
cd frontend
npm install
```

Use the Quick start section to run the dev server. The UI is at
`http://localhost:3000` and the API is at `http://localhost:8000`.

Frontend requests default to `/api` and are proxied to `http://localhost:8000` by
`frontend/next.config.ts`. To point elsewhere, set `NEXT_PUBLIC_API_BASE_URL`.

## Environment

Copy `.env.example` to `.env` and adjust as needed.
The API auto-loads `.env` at startup.
`.env.example` documents the default values (no overrides).

### YAMNet settings

- `YAMNET_HUB_URL`: TF Hub model URL.
- `YAMNET_CLASS_MAP_URL`: CSV label map URL.
- `YAMNET_CLASS_MAP_PATH`: Local path to cache the label map.

### Separation settings

- `HF_TOKEN`: Hugging Face token (mapped to `HUGGINGFACE_HUB_TOKEN`) for SAM-Audio weights.
- `SAM_AUDIO_DEVICE`: `auto` (default, prefers `cuda` then `mps`), `cuda`, `mps`, or `cpu`.
- `SAM_AUDIO_PREDICT_SPANS`: enable SAM-Audio span prediction (`true/false`).
- `SAM_AUDIO_RERANKING_CANDIDATES`: number of candidates to generate (default `1`).
- `SAM_AUDIO_DISABLE_RANKERS`: disable text/video rankers to avoid extra downloads (default `true`).
- `SAM_AUDIO_DISABLE_SPAN_PREDICTOR`: skip loading span predictor weights (default `true`).
- `SAM_AUDIO_DEVICE_FALLBACK`: if `true`, retry on CPU when GPU/MPS runs out of memory.
- `SAM_AUDIO_CHUNK_SECONDS`: chunk size (seconds) for full mixes; `0` disables chunking (default `30`).
- `SAM_AUDIO_CHUNK_OVERLAP`: overlap seconds between chunks to smooth joins (default `0.2`).
- `PREVIEW_SECONDS`: default preview length when requesting a preview mix.
- `JOB_MIX_HISTORY_LIMIT`: number of mix history entries to keep per job (default `10`).

Preview mixes can be requested by posting to `/jobs/{id}/mix` with:

```json
{
  "prompts": ["speech"],
  "gains": [1.0],
  "mode": "keep",
  "preview": true,
  "preview_seconds": 10
}
```

### Frontend settings

- `NEXT_PUBLIC_API_BASE_URL`: Override API base URL (default `/api`).

## Testing

After each change, run both backend and frontend checks. If you are not in the venv,
use `.venv/bin/...` or `source .venv/bin/activate`.

Backend:

```bash
.venv/bin/ruff check .
.venv/bin/pytest -q
.venv/bin/python -m app.core.audio_io --selftest
.venv/bin/pytest tests/test_e2e_smoke.py -q
```

Frontend (from `frontend/`):

```bash
npm run lint
npm run typecheck
npm run build
npx playwright install
npm run test:e2e
```

## License

This repository is MIT-licensed for the project code only. SAM-Audio, YAMNet,
and related model weights remain under their respective licenses/terms.
