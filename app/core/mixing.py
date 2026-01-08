from __future__ import annotations

import numpy as np


def apply_gain(audio: np.ndarray, gain: float) -> np.ndarray:
    return audio * float(gain)


def mix_tracks(tracks: list[np.ndarray]) -> np.ndarray:
    if not tracks:
        return np.zeros(0, dtype=np.float32)
    max_len = max(track.shape[0] for track in tracks)
    mix = np.zeros(max_len, dtype=np.float32)
    for track in tracks:
        padded = np.zeros(max_len, dtype=np.float32)
        padded[: track.shape[0]] = track.astype(np.float32, copy=False)
        mix += padded
    return mix


def peak_normalize(audio: np.ndarray, target_peak: float = 0.95) -> np.ndarray:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak == 0.0:
        return audio
    scale = min(1.0, target_peak / peak)
    return audio * scale


def limiter(audio: np.ndarray, threshold: float = 0.99) -> np.ndarray:
    return np.clip(audio, -threshold, threshold)
