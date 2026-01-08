import tempfile
from pathlib import Path

import numpy as np
import pytest

from app.core import audio_io
from app.worker import tasks


def test_e2e_smoke_pipeline(monkeypatch: pytest.MonkeyPatch):
    if not audio_io.dependencies_ok():
        pytest.skip("audio_io dependencies missing")
    sr = 8000
    duration = 0.5
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = (0.2 * np.sin(2 * np.pi * 220.0 * t) + 0.05 * np.random.randn(t.size)).astype(
        np.float32
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        input_path = tmpdir_path / "input.wav"
        output_path = tmpdir_path / "output.wav"
        audio_io.write_audio(input_path, audio, sr)

        def _fake_separate_prompt(
            audio_chunk: np.ndarray, _sr: int, _prompt: str
        ) -> tuple[np.ndarray, np.ndarray]:
            return audio_chunk, np.zeros_like(audio_chunk)

        monkeypatch.setattr(tasks, "separate_prompt", _fake_separate_prompt)

        candidates = tasks.build_candidates(audio, sr, top_n=3, use_yamnet=False)
        assert candidates
        assert "label" in candidates[0]

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

        preview_path = tmpdir_path / "preview.wav"
        tasks.process_job(
            input_path,
            preview_path,
            prompts=["sound"],
            gains=[1.0],
            mode="keep",
            target_sr=sr,
            preview_seconds=0.2,
            preview_start=0.1,
        )
        preview_audio, preview_sr = audio_io.read_audio(preview_path, target_sr=sr, mono=True)
        assert preview_sr == sr
        expected_samples = int(sr * 0.2)
        assert abs(preview_audio.shape[0] - expected_samples) <= 1
