from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel


class CandidateSegment(BaseModel):
    t0: float
    t1: float
    score: float


class Candidate(BaseModel):
    label: str
    score: float
    segments: list[CandidateSegment]


class JobStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class JobMixSummary(BaseModel):
    kind: Literal["preview", "full"]
    output_name: str
    preview_seconds: float | None = None
    preview_start: float | None = None
    updated_at: datetime | None = None


class CleanupRequest(BaseModel):
    keep_latest: int | None = None
    clear_outputs: bool = False
    clear_cache: bool = False


class Job(BaseModel):
    id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime | None = None
    detail: str | None = None
    candidates: list[Candidate] | None = None
    file_name: str | None = None
    duration_seconds: float | None = None
    last_mix: JobMixSummary | None = None
    mix_history: list[JobMixSummary] | None = None


class MixRequest(BaseModel):
    prompts: list[str]
    gains: list[float]
    mode: Literal["keep", "remove"] = "keep"
    preview: bool = False
    preview_seconds: float | None = None
    preview_start: float | None = None
    force: bool = False


class MixResponse(BaseModel):
    job_id: str
    status: JobStatus
    output_url: str | None = None
    detail: str | None = None
    progress: float | None = None
    chunks_done: int | None = None
    chunks_total: int | None = None
    eta_seconds: float | None = None
