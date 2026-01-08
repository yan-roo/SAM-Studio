from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv()

DEFAULT_SAMPLE_RATE = 16000


@dataclass(frozen=True)
class Settings:
    candidate_top_n: int = int(os.getenv("CANDIDATE_TOP_N", "12"))
    preview_seconds: int = int(os.getenv("PREVIEW_SECONDS", "10"))
    model_sam_audio_id: str = os.getenv("MODEL_SAM_AUDIO_ID", "facebook/sam-audio-small")


settings = Settings()
