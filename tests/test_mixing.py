import numpy as np

from app.core.mixing import apply_gain, limiter, mix_tracks, peak_normalize


def test_mixing_gain_and_normalize():
    audio = np.array([0.5, -0.5, 0.2], dtype=np.float32)
    gained = apply_gain(audio, 2.0)
    assert np.allclose(gained, np.array([1.0, -1.0, 0.4], dtype=np.float32))

    normalized = peak_normalize(gained, target_peak=0.8)
    assert np.max(np.abs(normalized)) <= 0.8001

    limited = limiter(np.array([1.2, -1.1, 0.4], dtype=np.float32), threshold=0.7)
    assert np.max(np.abs(limited)) <= 0.7


def test_mix_tracks_padding():
    a = np.ones(3, dtype=np.float32)
    b = np.ones(5, dtype=np.float32) * 2
    mixed = mix_tracks([a, b])
    assert mixed.shape[0] == 5
    assert np.allclose(mixed[:3], np.array([3, 3, 3], dtype=np.float32))
    assert np.allclose(mixed[3:], np.array([2, 2], dtype=np.float32))
