from __future__ import annotations

import logging
import os
import shutil
import time
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.audio_io import read_audio, slice_audio, write_audio
from app.core.config import DEFAULT_SAMPLE_RATE
from app.core.hash_cache import cache_path, fingerprint_settings, hash_file
from app.core.mixing import apply_gain, limiter, mix_tracks, peak_normalize
from app.worker.models.sam_audio import separate_prompt
from app.worker.models.yamnet import detect_candidates

logger = logging.getLogger("uvicorn.error")


class CancelledError(RuntimeError):
    pass


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _resolve_chunk_settings(preview_seconds: float | None) -> tuple[float, float]:
    chunk_seconds = _env_float("SAM_AUDIO_CHUNK_SECONDS", 30.0)
    overlap_seconds = _env_float("SAM_AUDIO_CHUNK_OVERLAP", 0.2)
    if preview_seconds is not None and preview_seconds > 0:
        return 0.0, 0.0
    if chunk_seconds <= 0:
        return 0.0, 0.0
    overlap_seconds = max(0.0, overlap_seconds)
    if overlap_seconds >= chunk_seconds:
        overlap_seconds = chunk_seconds * 0.5
    return chunk_seconds, overlap_seconds


def _chunk_cache_path(
    cache_dir: str | Path,
    audio_hash: str,
    settings_hash: str,
    start: int,
    end: int,
) -> Path:
    chunk_dir = Path(cache_dir) / "chunks" / audio_hash / settings_hash
    chunk_dir.mkdir(parents=True, exist_ok=True)
    return chunk_dir / f"chunk-{start}-{end}.wav"


def _build_chunk_ranges(
    total_len: int, chunk_samples: int, overlap_samples: int
) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    if total_len <= 0:
        return ranges
    step = max(1, chunk_samples - overlap_samples)
    start = 0
    while start < total_len:
        end = min(start + chunk_samples, total_len)
        ranges.append((start, end))
        if end == total_len:
            break
        start += step
    return ranges


def _load_cached_chunk(path: Path, expected_len: int, sr: int) -> np.ndarray | None:
    if not path.exists():
        return None
    chunk_audio, _ = read_audio(path, target_sr=sr, mono=True)
    if chunk_audio.shape[0] != expected_len:
        return None
    return chunk_audio


def build_settings_fingerprint(
    prompts: list[str],
    gains: list[float],
    mode: str,
    target_sr: int | None,
    preview_seconds: float | None = None,
    preview_start: float | None = None,
    chunk_seconds: float | None = None,
    chunk_overlap: float | None = None,
) -> str:
    settings = {
        "gains": gains,
        "mode": mode,
        "prompts": prompts,
        "preview_seconds": preview_seconds,
        "preview_start": preview_start,
        "target_sr": target_sr,
        "chunk_seconds": chunk_seconds,
        "chunk_overlap": chunk_overlap,
    }
    return fingerprint_settings(settings)


def build_candidates(
    audio: np.ndarray, sr: int, top_n: int = 12, use_yamnet: bool = True
) -> list[dict]:
    return detect_candidates(audio, sr, top_n=top_n, use_yamnet=use_yamnet)


def run_separation(
    audio: np.ndarray,
    sr: int,
    prompts: list[str],
    gains: list[float],
    mode: str = "keep",
    job_id: str | None = None,
) -> np.ndarray:
    residual = audio
    kept_tracks: list[np.ndarray] = []
    for prompt, gain in zip(prompts, gains):
        target, residual = separate_prompt(residual, sr, prompt, job_id=job_id)
        kept_tracks.append(apply_gain(target, gain))
    kept_mix = mix_tracks(kept_tracks)
    if mode == "keep":
        output = kept_mix
    elif mode == "remove":
        output = residual
    else:
        raise ValueError(f"unknown mode: {mode}")
    output = limiter(peak_normalize(output))
    return output


def run_separation_chunked(
    audio: np.ndarray,
    sr: int,
    prompts: list[str],
    gains: list[float],
    mode: str,
    chunk_seconds: float,
    overlap_seconds: float,
    cache_dir: str | Path | None = None,
    audio_hash: str | None = None,
    settings_hash: str | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
    job_id: str | None = None,
) -> np.ndarray:
    total_len = audio.shape[0]
    chunk_samples = int(round(chunk_seconds * sr))
    if chunk_samples <= 0 or total_len <= chunk_samples:
        return run_separation(audio, sr, prompts, gains, mode=mode, job_id=job_id)
    overlap_samples = int(round(overlap_seconds * sr))
    overlap_samples = max(0, min(overlap_samples, chunk_samples // 2))
    ranges = _build_chunk_ranges(total_len, chunk_samples, overlap_samples)
    total_chunks = len(ranges)
    output = np.zeros(total_len, dtype=np.float32)
    weight = np.zeros(total_len, dtype=np.float32)
    done_chunks = 0
    if progress_callback:
        progress_callback(done_chunks, total_chunks)
    for start, end in ranges:
        if should_cancel and should_cancel():
            raise CancelledError("cancelled")
        chunk_len = end - start
        chunk_audio = audio[start:end]
        chunk_path = None
        chunk_out = None
        if cache_dir and audio_hash and settings_hash:
            chunk_path = _chunk_cache_path(
                cache_dir, audio_hash, settings_hash, start, end)
            chunk_out = _load_cached_chunk(chunk_path, chunk_len, sr)
        if chunk_out is None:
            chunk_out = run_separation(
                chunk_audio, sr, prompts, gains, mode=mode, job_id=job_id
            )
            if chunk_path is not None:
                write_audio(chunk_path, chunk_out, sr)
        window = np.ones(end - start, dtype=np.float32)
        if start > 0 and overlap_samples > 0:
            fade_len = min(overlap_samples, end - start)
            fade_in = np.linspace(0.0, 1.0, num=fade_len, dtype=np.float32)
            window[:fade_len] *= fade_in
        if end < total_len and overlap_samples > 0:
            fade_len = min(overlap_samples, end - start)
            fade_out = np.linspace(1.0, 0.0, num=fade_len, dtype=np.float32)
            window[-fade_len:] *= fade_out
        output[start:end] += chunk_out * window
        weight[start:end] += window
        done_chunks += 1
        if progress_callback:
            progress_callback(done_chunks, total_chunks)
    output = np.divide(output, weight, out=output, where=weight > 0)
    output = limiter(peak_normalize(output))
    return output


def process_job(
    input_path: str | Path,
    output_path: str | Path,
    prompts: list[str],
    gains: list[float],
    mode: str = "keep",
    target_sr: int | None = DEFAULT_SAMPLE_RATE,
    preview_seconds: float | None = None,
    preview_start: float | None = None,
    cache_dir: str | Path | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
    job_id: str | None = None,
) -> Path:
    if should_cancel and should_cancel():
        raise CancelledError("cancelled")
    cache_target = None
    chunk_seconds, chunk_overlap = _resolve_chunk_settings(preview_seconds)
    audio_hash = None
    settings_hash = None
    if cache_dir is not None:
        audio_hash = hash_file(input_path)
        settings_hash = build_settings_fingerprint(
            prompts,
            gains,
            mode,
            target_sr,
            preview_seconds=preview_seconds,
            preview_start=preview_start,
            chunk_seconds=chunk_seconds,
            chunk_overlap=chunk_overlap,
        )
        cache_target = cache_path(
            cache_dir, audio_hash, settings_hash, suffix=".wav")
        if cache_target.exists():
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(cache_target, output_path)
            logger.info("Mix cache hit output=%s", output_path)
            return output_path

    job_tag = f" job={job_id}" if job_id else ""
    load_start = time.time()
    logger.info("Mix load audio%s input=%s", job_tag, input_path)
    audio, sr = read_audio(input_path, target_sr=target_sr, mono=True)
    logger.info(
        "Mix load audio done%s seconds=%.2f samples=%d sr=%d",
        job_tag,
        time.time() - load_start,
        audio.shape[0],
        sr,
    )
    if preview_seconds and preview_seconds > 0:
        start = float(preview_start or 0.0)
        if start < 0:
            start = 0.0
        end = start + float(preview_seconds)
        logger.info(
            "Mix preview slice%s start=%.2fs seconds=%.2fs",
            job_tag,
            start,
            preview_seconds,
        )
        audio = slice_audio(audio, sr, start, end)
    duration = audio.shape[0] / float(sr) if sr else 0.0
    sep_start = time.time()
    logger.info(
        "Mix separate start%s prompts=%d mode=%s duration=%.2fs",
        job_tag,
        len(prompts),
        mode,
        duration,
    )
    if chunk_seconds > 0 and duration > chunk_seconds:
        output = run_separation_chunked(
            audio,
            sr,
            prompts,
            gains,
            mode=mode,
            chunk_seconds=chunk_seconds,
            overlap_seconds=chunk_overlap,
            cache_dir=cache_dir,
            audio_hash=audio_hash,
            settings_hash=settings_hash,
            progress_callback=progress_callback,
            should_cancel=should_cancel,
            job_id=job_id,
        )
    else:
        output = run_separation(audio, sr, prompts, gains, mode=mode, job_id=job_id)
        if progress_callback:
            progress_callback(1, 1)
    logger.info("Mix separate done%s seconds=%.2f", job_tag, time.time() - sep_start)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_start = time.time()
    write_audio(output_path, output, sr)
    logger.info(
        "Mix write output%s seconds=%.2f output=%s",
        job_tag,
        time.time() - write_start,
        output_path,
    )
    if cache_target is not None:
        cache_target.parent.mkdir(parents=True, exist_ok=True)
        if cache_target.resolve() != output_path.resolve():
            shutil.copyfile(output_path, cache_target)
    return output_path
