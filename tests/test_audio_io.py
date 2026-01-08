import tempfile
from pathlib import Path

import numpy as np
import pytest

from app.core import audio_io


def test_audio_io_roundtrip_and_slice():
    if not audio_io.dependencies_ok():
        pytest.skip("audio_io dependencies missing")
    sr = 8000
    duration = 0.5
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    tone = 0.2 * np.sin(2 * np.pi * 220.0 * t).astype(np.float32)

    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "tone.wav"
        audio_io.write_audio(path, tone, sr)
        audio, out_sr = audio_io.read_audio(path, target_sr=4000, mono=True)
        assert out_sr == 4000
        assert audio.shape[0] == 2000

        clip = audio_io.slice_audio(audio, 4000, 0.1, 0.2)
        assert clip.shape[0] == 400
