import tempfile
from pathlib import Path

import numpy as np
import pytest

from app.core import audio_io
from app.core.hash_cache import cache_path, hash_file
from app.worker import tasks


def test_process_job_cache_hit(monkeypatch: pytest.MonkeyPatch) -> None:
    if not audio_io.dependencies_ok():
        pytest.skip("audio_io dependencies missing")
    sr = 8000
    duration = 0.4
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = (0.2 * np.sin(2 * np.pi * 330.0 * t)).astype(np.float32)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        input_path = tmpdir_path / "input.wav"
        output_path = tmpdir_path / "output.wav"
        cache_dir = tmpdir_path / "cache"
        audio_io.write_audio(input_path, audio, sr)

        def _fake_separate_prompt(
            audio_chunk: np.ndarray, _sr: int, _prompt: str
        ) -> tuple[np.ndarray, np.ndarray]:
            return audio_chunk, np.zeros_like(audio_chunk)

        monkeypatch.setattr(tasks, "separate_prompt", _fake_separate_prompt)

        tasks.process_job(
            input_path,
            output_path,
            prompts=["sound"],
            gains=[1.0],
            mode="keep",
            target_sr=sr,
            cache_dir=cache_dir,
        )

        audio_hash = hash_file(input_path)
        chunk_seconds, chunk_overlap = tasks._resolve_chunk_settings(None)
        settings_hash = tasks.build_settings_fingerprint(
            ["sound"],
            [1.0],
            "keep",
            sr,
            chunk_seconds=chunk_seconds,
            chunk_overlap=chunk_overlap,
        )
        cached = cache_path(cache_dir, audio_hash, settings_hash, suffix=".wav")
        assert cached.exists()

        def _fail(*_args, **_kwargs):
            raise RuntimeError("run_separation should not be called on cache hit")

        monkeypatch.setattr(tasks, "run_separation", _fail)

        output_path_2 = tmpdir_path / "output2.wav"
        tasks.process_job(
            input_path,
            output_path_2,
            prompts=["sound"],
            gains=[1.0],
            mode="keep",
            target_sr=sr,
            cache_dir=cache_dir,
        )

        assert output_path_2.exists()


def test_process_job_chunked(monkeypatch: pytest.MonkeyPatch) -> None:
    if not audio_io.dependencies_ok():
        pytest.skip("audio_io dependencies missing")
    monkeypatch.setenv("SAM_AUDIO_CHUNK_SECONDS", "0.5")
    monkeypatch.setenv("SAM_AUDIO_CHUNK_OVERLAP", "0.1")
    sr = 8000
    duration = 1.2
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = (0.2 * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        input_path = tmpdir_path / "input.wav"
        output_path = tmpdir_path / "output.wav"
        audio_io.write_audio(input_path, audio, sr)

        calls: list[int] = []

        def _fake_run_separation(
            audio_chunk: np.ndarray,
            _sr: int,
            _prompts: list[str],
            _gains: list[float],
            mode: str = "keep",
        ) -> np.ndarray:
            _ = mode
            calls.append(audio_chunk.shape[0])
            return audio_chunk

        monkeypatch.setattr(tasks, "run_separation", _fake_run_separation)

        tasks.process_job(
            input_path,
            output_path,
            prompts=["sound"],
            gains=[1.0],
            mode="keep",
            target_sr=sr,
        )

        assert output_path.exists()
        out_audio, out_sr = audio_io.read_audio(output_path, target_sr=sr, mono=True)
        assert out_sr == sr
        assert out_audio.shape[0] == audio.shape[0]
        assert len(calls) >= 2
