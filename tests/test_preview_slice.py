import tempfile
from pathlib import Path

import numpy as np
import pytest

from app.core import audio_io
from app.worker import tasks


def test_preview_negative_start_clamps_to_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    if not audio_io.dependencies_ok():
        pytest.skip("audio_io dependencies missing")
    sr = 8000
    duration = 0.5
    audio = np.linspace(-1.0, 1.0, int(sr * duration), endpoint=False).astype(
        np.float32
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        input_path = tmpdir_path / "input.wav"
        output_path = tmpdir_path / "preview.wav"
        audio_io.write_audio(input_path, audio, sr)

        def _fake_run_separation(
            audio_chunk: np.ndarray,
            _sr: int,
            _prompts: list[str],
            _gains: list[float],
            mode: str = "keep",
        ) -> np.ndarray:
            _ = mode
            return audio_chunk

        monkeypatch.setattr(tasks, "run_separation", _fake_run_separation)

        tasks.process_job(
            input_path,
            output_path,
            prompts=["sound"],
            gains=[1.0],
            mode="keep",
            target_sr=sr,
            preview_seconds=0.2,
            preview_start=-0.1,
        )

        out_audio, out_sr = audio_io.read_audio(output_path, target_sr=sr, mono=True)
        assert out_sr == sr
        expected = audio_io.slice_audio(audio, sr, 0.0, 0.2)
        assert abs(out_audio.shape[0] - expected.shape[0]) <= 1
        assert np.allclose(out_audio[: expected.shape[0]], expected, atol=1e-4)
