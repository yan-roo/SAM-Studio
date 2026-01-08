import numpy as np

from app.core.segments import merge_segments, segments_from_scores


def test_segments_from_scores_and_merge_gap():
    times = np.arange(0.0, 1.0, 0.1)
    scores = np.array([0.1, 0.8, 0.9, 0.2, 0.85, 0.9, 0.1, 0.0, 0.95, 0.96])
    segments = segments_from_scores(times, scores, threshold=0.8, merge_gap=0.05)
    assert len(segments) == 3
    assert segments[0].start == 0.1
    assert segments[0].end == 0.3

    merged = merge_segments(segments, merge_gap=0.15)
    assert len(merged) == 2
    assert merged[0].start == 0.1
    assert merged[0].end == 0.6
