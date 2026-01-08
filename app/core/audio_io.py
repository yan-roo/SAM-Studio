from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Tuple

import numpy as np

try:
    import soundfile as sf
except ModuleNotFoundError as exc:  # pragma: no cover - exercised via dependency check
    sf = None
    _SOUND_FILE_ERROR = exc
else:  # pragma: no cover - just a marker
    _SOUND_FILE_ERROR = None


def dependencies_ok() -> bool:
    return sf is not None


def _require_lib(name: str, lib, err: Exception | None) -> None:
    if lib is None:
        raise RuntimeError(
            f"{name} is required for audio I/O; install dependencies to use this feature."
        ) from err


def read_audio(
    path: str | Path, target_sr: int | None = None, mono: bool = True
) -> Tuple[np.ndarray, int]:
    _require_lib("soundfile", sf, _SOUND_FILE_ERROR)
    audio, sr = sf.read(str(path), always_2d=False)
    audio = audio.astype(np.float32, copy=False)
    if mono and audio.ndim == 2:
        audio = np.mean(audio, axis=1)
    if target_sr is not None and sr != target_sr:
        audio = resample_audio(audio, sr, target_sr)
        sr = target_sr
    return audio, sr


def write_audio(path: str | Path, audio: np.ndarray, sr: int) -> None:
    _require_lib("soundfile", sf, _SOUND_FILE_ERROR)
    audio = audio.astype(np.float32, copy=False)
    sf.write(str(path), audio, sr)


def resample_audio(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr:
        return audio
    if audio.size == 0:
        return audio.astype(np.float32, copy=False)
    duration = audio.shape[0] / float(orig_sr)
    target_len = max(1, int(round(duration * target_sr)))
    x_old = np.linspace(0.0, duration, num=audio.shape[0], endpoint=False)
    x_new = np.linspace(0.0, duration, num=target_len, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def slice_audio(audio: np.ndarray, sr: int, t0: float, t1: float) -> np.ndarray:
    start = max(0, int(math.floor(t0 * sr)))
    end = max(start, int(math.ceil(t1 * sr)))
    return audio[start:end]


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def extract_audio(
    input_path: str | Path, output_path: str | Path, target_sr: int, mono: bool = True
) -> None:
    input_path = Path(input_path)
    output_path = Path(output_path)
    if input_path.suffix.lower() == ".wav":
        audio, sr = read_audio(input_path, target_sr=target_sr, mono=mono)
        write_audio(output_path, audio, sr)
        return
    if not ffmpeg_available():
        raise RuntimeError("ffmpeg not found; install it to convert non-wav inputs.")
    channels = "1" if mono else "2"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        channels,
        "-ar",
        str(target_sr),
        "-f",
        "wav",
        str(output_path),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def _selftest() -> None:
    if not dependencies_ok():
        raise RuntimeError("audio_io dependencies missing; install soundfile")
    sr = 16000
    duration = 1.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    tone = 0.25 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        raw_path = tmpdir_path / "tone.wav"
        write_audio(raw_path, tone, sr)
        audio, loaded_sr = read_audio(raw_path, target_sr=8000, mono=True)
        assert loaded_sr == 8000
        assert audio.shape[0] == 8000
        slice_part = slice_audio(audio, 8000, 0.2, 0.4)
        assert slice_part.shape[0] == 1600


def main() -> None:
    parser = argparse.ArgumentParser(description="audio_io helper")
    parser.add_argument("--selftest", action="store_true", help="run self-test")
    args = parser.parse_args()
    if args.selftest:
        _selftest()
        print("audio_io selftest ok")


if __name__ == "__main__":
    main()
