from __future__ import annotations

from typing import Tuple


def classify_error(exc: Exception) -> Tuple[str, str]:
    message = str(exc).strip()
    lowered = message.lower()
    if not message:
        message = exc.__class__.__name__
        lowered = message.lower()

    if "input audio not found" in lowered:
        return "INPUT_NOT_FOUND", message
    if "ffmpeg not found" in lowered or ("ffmpeg" in lowered and "not found" in lowered):
        return "FFMPEG_MISSING", message
    if "soundfile is required" in lowered or ("soundfile" in lowered and "audio i/o" in lowered):
        return "SOUNDFILE_MISSING", message
    if "sam-audio is not installed" in lowered or "no module named 'sam_audio'" in lowered:
        return "SAM_AUDIO_MISSING", message
    if "pytorch is required" in lowered or "no module named 'torch'" in lowered:
        return "TORCH_MISSING", message
    if "out of memory" in lowered:
        return "DEVICE_OOM", message
    if "expected input" in lowered and "channels" in lowered and "but got" in lowered:
        return "SHAPE_MISMATCH", message
    if "hf_token" in lowered or ("token" in lowered and "huggingface" in lowered):
        return "HF_TOKEN_MISSING", message
    if "gated" in lowered or (
        "huggingface" in lowered
        and (
            "access" in lowered
            or "unauthorized" in lowered
            or "forbidden" in lowered
            or "not found" in lowered
        )
    ):
        return "HF_ACCESS", message

    return "UNKNOWN_ERROR", message
