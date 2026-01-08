from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core import audio_io

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("/{job_id}/output")
def get_output(job_id: str, name: str | None = None) -> FileResponse:
    output_dir = Path("data/outputs") / job_id
    output_name = name or "output.wav"
    if Path(output_name).name != output_name or not output_name.endswith(".wav"):
        raise HTTPException(status_code=400, detail="invalid output name")
    output_path = output_dir / output_name
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="output not available")
    return FileResponse(output_path)


@router.get("/{job_id}/input")
def get_input(
    job_id: str,
    preview_seconds: float | None = None,
    preview_start: float | None = None,
) -> FileResponse:
    input_path = Path("data/uploads") / job_id / "input.wav"
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="input not available")
    if preview_seconds is not None and preview_seconds > 0:
        start = float(preview_start or 0.0)
        if start < 0:
            start = 0.0
        audio, sr = audio_io.read_audio(input_path, mono=True)
        duration = audio.shape[0] / float(sr) if sr else 0.0
        if duration <= 0 or start >= duration:
            raise HTTPException(status_code=400, detail="preview_start exceeds audio length")
        end = min(start + float(preview_seconds), duration)
        preview_audio = audio_io.slice_audio(audio, sr, start, end)
        output_dir = Path("data/outputs") / job_id
        output_dir.mkdir(parents=True, exist_ok=True)
        start_ms = int(round(start * 1000))
        duration_ms = int(round((end - start) * 1000))
        preview_path = output_dir / f"input-preview-{start_ms}ms-{duration_ms}ms.wav"
        if not preview_path.exists():
            audio_io.write_audio(preview_path, preview_audio, sr)
        return FileResponse(preview_path)
    return FileResponse(input_path)
