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

## Quick start (3 lines setup + 2 lines run)

```bash
scripts/setup_all.sh --dev
export HF_TOKEN=hf_xxx
scripts/download_sam_audio_model.sh && scripts/setup_env.sh
```

Run the app (two terminals):

```bash
scripts/run_api.sh
scripts/run_frontend.sh
```

The UI is at `http://localhost:3000` and the API is at `http://localhost:8000`.

Frontend requests default to `/api` and are proxied to `http://localhost:8000` by
`frontend/next.config.ts`.

## Google Colab (GPU-friendly setup)

In Google Colab, use a GPU runtime, then run:

```python
import os
os.environ["HF_TOKEN"] = "hf_xxx"  # required for model download
```

```bash
git clone <your-repo-url>
cd SAM-Studio
bash scripts/setup_colab.sh --download-model --download-assets
```

Notes:
- `scripts/setup_colab.sh` avoids reinstalling `torch`, so Colab's GPU build stays intact.
- Use `--no-yamnet` if you want a faster install without TensorFlow.

## Environment

Create/update `.env` with:

```bash
scripts/setup_env.sh
```

The API auto-loads `.env` at startup. The script applies safe defaults and will
auto-set `MODEL_SAM_AUDIO_ID=models/sam-audio-small` if that folder exists.
`.env.example` documents the default values.

### Core settings

- `HF_TOKEN`: Hugging Face token for SAM-Audio weights.
- `MODEL_SAM_AUDIO_ID`: model path or HF repo id. Defaults to `models/sam-audio-small` when present.
- `SAM_AUDIO_DEVICE`: `auto` (default, prefers `cuda` then `mps`), `cuda`, `mps`, or `cpu`.

### Advanced settings (optional)

- `SAM_AUDIO_CHUNK_SECONDS`: chunk size (seconds) for full mixes; `0` disables chunking (default `30`).
- `SAM_AUDIO_CHUNK_OVERLAP`: overlap seconds between chunks to smooth joins (default `0.2`).
- `PREVIEW_SECONDS`: default preview length when requesting a preview mix.

Other internal toggles (YAMNet URLs, SAM-Audio rankers/span predictor, history limits)
are documented in `.env.example`, but most users should leave them at defaults.

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

## Benchmark assets (3 short clips)

Download a small, repeatable benchmark pack:

```bash
scripts/download_benchmark_assets.sh
```

Assets are written to `data/benchmarks/assets` (gitignored).

Run the benchmark and print a timing table:

```bash
.venv/bin/python scripts/benchmark_sam_audio.py --preview-seconds 20 --warmup 1 --repeats 3
```

This prints a Markdown timing table (mean + P95 over repeats) and writes JSON
(`meta` + `results`) to `data/benchmarks/benchmark-results.json`. For a quick smoke test, add
`--limit 1 --preview-seconds 3 --warmup 1 --repeats 2`.

Force a device for comparison:

```bash
SAM_AUDIO_DEVICE=mps .venv/bin/python scripts/benchmark_sam_audio.py --preview-seconds 20 --warmup 1 --repeats 3 --json-out data/benchmarks/benchmark-results-mps.json
SAM_AUDIO_DEVICE=cpu .venv/bin/python scripts/benchmark_sam_audio.py --preview-seconds 20 --warmup 1 --repeats 3 --json-out data/benchmarks/benchmark-results-cpu.json
```

Generate a device comparison table from the JSON results:

```bash
.venv/bin/python scripts/benchmark_compare.py
```

Included clips:
- `speech_voices_20s_16k.wav` (torchaudio VOiCES speech sample)
- `whistle_train_20s_16k.wav` (torchaudio tutorial whistle)
- `music_sample2_20s_16k.wav` (Wikimedia Commons music sample)
- `mix_speech_plus_music_20s_16k.wav` (local mix for discriminative prompts)

Suggested prompts:
- `speech`
- `whistle` or `train whistle`
- `music`
- `speech` + `music` (on the mixed clip)

### Example benchmark results (local)

Hardware used for these results: MacBook Pro (Apple M1 Pro, 16 GB RAM), macOS, Python 3.11.

Settings used: `preview_seconds=20`, `warmup=1`, `repeats=3`.

MPS (`SAM_AUDIO_DEVICE=mps`):

| case | prompts | mean_s | p95_s | x_realtime_mean |
| --- | --- | ---: | ---: | ---: |
| speech | speech | 30.9 | 37.2 | 0.65 |
| whistle | whistle | 45.6 | 47.3 | 0.44 |
| music | music | 51.5 | 52.6 | 0.39 |
| mix_speech_music | speech, music | 99.0 | 99.8 | 0.20 |

CPU (`SAM_AUDIO_DEVICE=cpu`):

| case | prompts | mean_s | p95_s | x_realtime_mean |
| --- | --- | ---: | ---: | ---: |
| speech | speech | 58.3 | 60.2 | 0.34 |
| whistle | whistle | 58.5 | 63.9 | 0.34 |
| music | music | 58.7 | 61.0 | 0.34 |
| mix_speech_music | speech, music | 112.9 | 116.7 | 0.18 |

These numbers are hardware- and cache-dependent; use them as a relative baseline.

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
