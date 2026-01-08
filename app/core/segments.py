from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    score: float


def _frame_duration(times: np.ndarray) -> float:
    if times.size < 2:
        return 0.0
    diffs = np.diff(times)
    return float(np.median(diffs))


def segments_from_scores(
    times: np.ndarray,
    scores: np.ndarray,
    threshold: float,
    merge_gap: float = 0.2,
    min_duration: float = 0.0,
) -> list[Segment]:
    if times.size == 0:
        return []
    active = scores >= threshold
    if not np.any(active):
        return []
    frame = _frame_duration(times)
    indices = np.flatnonzero(active)
    segments: list[Segment] = []
    start_idx = indices[0]
    prev_idx = indices[0]
    for idx in indices[1:]:
        if idx != prev_idx + 1:
            segment = _segment_from_range(times, scores, start_idx, prev_idx, frame)
            segments.append(segment)
            start_idx = idx
        prev_idx = idx
    segments.append(_segment_from_range(times, scores, start_idx, prev_idx, frame))
    merged = merge_segments(segments, merge_gap=merge_gap)
    if min_duration > 0:
        merged = [seg for seg in merged if (seg.end - seg.start) >= min_duration]
    return merged


def _segment_from_range(
    times: np.ndarray, scores: np.ndarray, start_idx: int, end_idx: int, frame: float
) -> Segment:
    start = float(times[start_idx])
    end = float(times[end_idx] + frame)
    score = float(np.max(scores[start_idx : end_idx + 1]))
    return Segment(start=start, end=end, score=score)


def merge_segments(segments: list[Segment], merge_gap: float = 0.2) -> list[Segment]:
    if not segments:
        return []
    segments = sorted(segments, key=lambda seg: seg.start)
    merged: list[Segment] = [segments[0]]
    for seg in segments[1:]:
        last = merged[-1]
        gap = seg.start - last.end
        if gap <= merge_gap:
            merged[-1] = Segment(
                start=last.start,
                end=max(last.end, seg.end),
                score=max(last.score, seg.score),
            )
        else:
            merged.append(seg)
    return merged
