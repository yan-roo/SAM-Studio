import numpy as np

from app.worker import tasks


def test_energy_candidates_have_segments_within_duration():
    sr = 8000
    duration = 2.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = (0.5 * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)

    candidates = tasks.build_candidates(audio, sr, top_n=1, use_yamnet=False)
    assert candidates
    segments = candidates[0].get("segments", [])
    assert segments
    for segment in segments:
        assert 0 <= segment["t0"] < segment["t1"] <= duration
