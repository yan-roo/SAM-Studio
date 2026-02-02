from __future__ import annotations

import csv
import os
import urllib.request
from pathlib import Path

import numpy as np

from app.core.audio_io import resample_audio
from app.core.segments import segments_from_scores

YAMNET_SAMPLE_RATE = 16000
DEFAULT_FRAME_SECONDS = 0.96
DEFAULT_HOP_SECONDS = 0.48
YAMNET_HUB_URL = os.getenv("YAMNET_HUB_URL", "https://tfhub.dev/google/yamnet/1")
YAMNET_CLASS_MAP_URL = os.getenv(
    "YAMNET_CLASS_MAP_URL",
    "https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv",
)

_TF = None
_HUB = None
_MODEL = None
_LABELS: list[str] | None = None


def _ensure_tfhub_cache_dir() -> None:
    raw = os.getenv("TFHUB_CACHE_DIR")
    if not raw:
        try:
            from dotenv import load_dotenv
        except Exception:
            load_dotenv = None
        if load_dotenv is not None:
            load_dotenv()
            raw = os.getenv("TFHUB_CACHE_DIR")
    if not raw:
        return
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    path.mkdir(parents=True, exist_ok=True)
    os.environ["TFHUB_CACHE_DIR"] = str(path)


def _lazy_import_tf():
    global _TF, _HUB
    if _TF is None:
        try:
            _ensure_tfhub_cache_dir()
            import tensorflow as tf
            import tensorflow_hub as hub
        except ModuleNotFoundError:
            _TF = False
            _HUB = False
        else:
            _TF = tf
            _HUB = hub
    if _TF is False or _HUB is False:
        return None, None
    return _TF, _HUB


def _load_model():
    global _MODEL
    _tf, hub = _lazy_import_tf()
    if hub is None:
        return None
    if _MODEL is None:
        _MODEL = hub.load(YAMNET_HUB_URL)
    return _MODEL


def _class_map_paths() -> list[Path]:
    env_path = os.getenv("YAMNET_CLASS_MAP_PATH")
    if env_path:
        return [Path(env_path)]
    local_path = Path(__file__).with_name("yamnet_class_map.csv")
    return [local_path, Path("data/cache/yamnet_class_map.csv")]


def _read_labels(path: Path) -> list[str]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        return [row["display_name"] for row in reader if "display_name" in row]


def _load_labels() -> list[str]:
    global _LABELS
    if _LABELS is not None:
        return _LABELS
    paths = _class_map_paths()
    for path in paths:
        if path.exists():
            try:
                labels = _read_labels(path)
            except Exception:
                continue
            if labels:
                _LABELS = labels
                return _LABELS
    download_path = paths[-1]
    download_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        urllib.request.urlretrieve(YAMNET_CLASS_MAP_URL, download_path)
    except Exception:
        return []
    try:
        labels = _read_labels(download_path)
    except Exception:
        return []
    _LABELS = labels
    return _LABELS


def _energy_candidates(
    audio: np.ndarray,
    sr: int,
    top_n: int,
    frame_seconds: float,
    hop_seconds: float,
    threshold: float,
    merge_gap: float,
    min_duration: float,
) -> list[dict]:
    frame_len = max(1, int(frame_seconds * sr))
    hop_len = max(1, int(hop_seconds * sr))
    energies = []
    times = []
    for start in range(0, max(1, audio.shape[0] - frame_len + 1), hop_len):
        frame = audio[start : start + frame_len]
        rms = float(np.sqrt(np.mean(frame**2)))
        energies.append(rms)
        times.append(start / sr)
    energies_arr = np.array(energies, dtype=np.float32)
    times_arr = np.array(times, dtype=np.float32)
    segments = segments_from_scores(
        times_arr,
        energies_arr,
        threshold=threshold,
        merge_gap=merge_gap,
        min_duration=min_duration,
    )
    candidate = {
        "label": "sound",
        "score": float(np.max(energies_arr)) if energies_arr.size else 0.0,
        "segments": [
            {"t0": seg.start, "t1": seg.end, "score": seg.score} for seg in segments
        ],
    }
    return [candidate][:top_n]


def detect_candidates(
    audio: np.ndarray,
    sr: int,
    top_n: int = 12,
    frame_seconds: float = DEFAULT_FRAME_SECONDS,
    hop_seconds: float = DEFAULT_HOP_SECONDS,
    threshold: float = 0.1,
    merge_gap: float = 0.2,
    min_duration: float = 0.0,
    use_yamnet: bool = True,
) -> list[dict]:
    if audio.size == 0:
        return []

    if use_yamnet:
        model = _load_model()
        if model is not None:
            if sr != YAMNET_SAMPLE_RATE:
                waveform = resample_audio(audio, sr, YAMNET_SAMPLE_RATE)
            else:
                waveform = audio
            waveform = waveform.astype(np.float32, copy=False)
            peak = float(np.max(np.abs(waveform))) if waveform.size else 0.0
            if peak > 1.0:
                waveform = waveform / peak
            try:
                scores, _embeddings, _spectrogram = model(waveform)
            except Exception:
                return _energy_candidates(
                    audio,
                    sr,
                    top_n,
                    frame_seconds,
                    hop_seconds,
                    threshold,
                    merge_gap,
                    min_duration,
                )
            scores_np = scores.numpy()
            if scores_np.size == 0:
                return []
            times = np.arange(scores_np.shape[0], dtype=np.float32) * hop_seconds
            labels = _load_labels()
            class_scores = scores_np.max(axis=0)
            top_indices = np.argsort(class_scores)[::-1][:top_n]
            candidates = []
            for idx in top_indices:
                label = labels[idx] if idx < len(labels) else f"class_{idx}"
                label_scores = scores_np[:, idx]
                segments = segments_from_scores(
                    times,
                    label_scores,
                    threshold=threshold,
                    merge_gap=merge_gap,
                    min_duration=min_duration,
                )
                candidates.append(
                    {
                        "label": label,
                        "score": float(class_scores[idx]),
                        "segments": [
                            {"t0": seg.start, "t1": seg.end, "score": seg.score}
                            for seg in segments
                        ],
                    }
                )
            return candidates

    return _energy_candidates(
        audio,
        sr,
        top_n,
        frame_seconds,
        hop_seconds,
        threshold,
        merge_gap,
        min_duration,
    )
