from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.api.schemas import (
    CleanupRequest,
    Job,
    JobMixSummary,
    JobStatus,
    MixRequest,
    MixResponse,
)
from app.core import audio_io
from app.core.config import DEFAULT_SAMPLE_RATE, settings
from app.core.errors import classify_error
from app.worker import tasks

router = APIRouter(prefix="/jobs", tags=["jobs"])
logger = logging.getLogger("uvicorn.error")

_jobs: dict[str, Job] = {}
_upload_root = Path("data/uploads")
_output_root = Path("data/outputs")
_cache_root = Path("data/cache")
_job_store_root = Path("data/jobs")
_allowed_suffixes = {".wav", ".mp3", ".m4a", ".mp4"}
_job_files: dict[str, dict[str, Path]] = {}
_mix_states: dict[str, MixResponse] = {}
_mix_tokens: dict[str, str] = {}
_mix_lock = threading.Lock()
_jobs_lock = threading.Lock()

_job_store_root.mkdir(parents=True, exist_ok=True)


def _json_default(value: object) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _mix_history_limit() -> int:
    return max(1, _env_int("JOB_MIX_HISTORY_LIMIT", 10))


def _job_payload(job: Job) -> dict:
    if hasattr(job, "model_dump"):
        return job.model_dump(mode="json")
    return job.dict()


def _persist_job(job: Job) -> None:
    payload = _job_payload(job)
    path = _job_store_root / f"{job.id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=True, default=_json_default))
    tmp_path.replace(path)


def _set_job(job: Job) -> None:
    with _jobs_lock:
        _jobs[job.id] = job
    _persist_job(job)


def _hydrate_job_files(job_id: str) -> None:
    upload_dir = _upload_root / job_id
    wav_path = upload_dir / "input.wav"
    if not wav_path.exists():
        return
    input_path = wav_path
    for candidate in upload_dir.glob("input.*"):
        if candidate.name != "input.wav":
            input_path = candidate
            break
    _job_files[job_id] = {
        "input": input_path,
        "wav": wav_path,
        "output": _output_root / job_id / "output.wav",
    }


def _load_jobs_from_disk() -> None:
    if not _job_store_root.exists():
        return
    for path in sorted(_job_store_root.glob("*.json")):
        try:
            payload = json.loads(path.read_text())
            job = Job(**payload)
        except Exception as exc:
            logger.warning("Failed to load job history %s: %s", path.name, exc)
            continue
        with _jobs_lock:
            _jobs[job.id] = job
        _hydrate_job_files(job.id)


def _purge_job_files(job_id: str) -> None:
    upload_dir = _upload_root / job_id
    output_dir = _output_root / job_id
    if upload_dir.exists():
        shutil.rmtree(upload_dir, ignore_errors=True)
    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)


def _purge_output_dir(job_id: str) -> bool:
    output_dir = _output_root / job_id
    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)
        return True
    return False


def _append_mix_history(job: Job, summary: JobMixSummary) -> Job:
    history = list(job.mix_history or [])
    history.append(summary)
    limit = _mix_history_limit()
    if len(history) > limit:
        history = history[-limit:]
    return job.copy(update={"last_mix": summary, "mix_history": history})


def _get_mix_state(job_id: str) -> MixResponse | None:
    with _mix_lock:
        return _mix_states.get(job_id)


def _get_mix_token(job_id: str) -> str | None:
    with _mix_lock:
        return _mix_tokens.get(job_id)


def _set_mix_state(
    job_id: str,
    status: JobStatus,
    output_url: str | None = None,
    detail: str | None = None,
    error_code: str | None = None,
    token: str | None = None,
    progress: float | None = None,
    chunks_done: int | None = None,
    chunks_total: int | None = None,
    eta_seconds: float | None = None,
) -> MixResponse:
    state = MixResponse(
        job_id=job_id,
        status=status,
        output_url=output_url,
        detail=detail,
        error_code=error_code,
        progress=progress,
        chunks_done=chunks_done,
        chunks_total=chunks_total,
        eta_seconds=eta_seconds,
    )
    with _mix_lock:
        _mix_states[job_id] = state
        if token is not None:
            _mix_tokens[job_id] = token
    return state


def _update_mix_progress(
    job_id: str,
    chunks_done: int,
    chunks_total: int,
    eta_seconds: float | None,
    token: str | None = None,
) -> MixResponse:
    state = _get_mix_state(job_id)
    output_url = state.output_url if state else None
    detail = state.detail if state else None
    error_code = state.error_code if state else None
    progress = float(chunks_done) / float(chunks_total) if chunks_total > 0 else None
    return _set_mix_state(
        job_id,
        JobStatus.RUNNING,
        output_url=output_url,
        detail=detail,
        error_code=error_code,
        token=token,
        progress=progress,
        chunks_done=chunks_done,
        chunks_total=chunks_total,
        eta_seconds=eta_seconds,
    )


def _should_finalize(job_id: str, token: str) -> bool:
    with _mix_lock:
        state = _mix_states.get(job_id)
        return (
            state is not None
            and state.status == JobStatus.RUNNING
            and _mix_tokens.get(job_id) == token
        )


def _latest_output_file(job_id: str) -> Path | None:
    output_dir = _output_root / job_id
    if not output_dir.exists():
        return None
    candidates = [
        path
        for path in output_dir.iterdir()
        if path.is_file() and path.suffix == ".wav" and path.name.startswith("output")
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime)


@router.post("/", response_model=Job)
@router.post("", response_model=Job, include_in_schema=False)
async def create_job(
    file: UploadFile = File(...),
    use_yamnet: bool = True,
    top_n: int = settings.candidate_top_n,
) -> Job:
    job_id = str(uuid.uuid4())
    created_at = datetime.utcnow()
    original_name = file.filename or None
    suffix = Path(original_name or "").suffix.lower()
    if suffix not in _allowed_suffixes:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "UNSUPPORTED_FILE", "detail": "unsupported file type"},
        )
    job_dir = _upload_root / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    input_path = job_dir / f"input{suffix}"
    input_path.write_bytes(await file.read())
    await file.close()

    wav_path = job_dir / "input.wav"
    output_path = _output_root / job_id / "output.wav"
    try:
        logger.info("Job upload received job=%s file=%s", job_id, original_name)
        audio_io.extract_audio(input_path, wav_path, target_sr=DEFAULT_SAMPLE_RATE, mono=True)
        logger.info("Job audio extracted job=%s", job_id)
        audio, sr = audio_io.read_audio(wav_path, target_sr=DEFAULT_SAMPLE_RATE, mono=True)
        logger.info("Job audio loaded job=%s samples=%d sr=%d", job_id, audio.shape[0], sr)
        candidates = tasks.build_candidates(audio, sr, top_n=top_n, use_yamnet=use_yamnet)
        logger.info("Job candidates built job=%s count=%d", job_id, len(candidates))
        duration_seconds = audio.shape[0] / float(sr) if sr else None
        job = Job(
            id=job_id,
            status=JobStatus.DONE,
            created_at=created_at,
            updated_at=datetime.utcnow(),
            candidates=candidates,
            file_name=original_name,
            duration_seconds=duration_seconds,
        )
        _job_files[job_id] = {
            "input": input_path,
            "wav": wav_path,
            "output": output_path,
        }
        _set_job(job)
        return job
    except Exception as exc:
        code, detail = classify_error(exc)
        job = Job(
            id=job_id,
            status=JobStatus.FAILED,
            created_at=created_at,
            updated_at=datetime.utcnow(),
            detail=detail,
            error_code=code,
            file_name=original_name,
        )
        _set_job(job)
        raise HTTPException(status_code=500, detail={"error_code": code, "detail": detail})


@router.get("/{job_id}/mix", response_model=MixResponse)
def get_mix_status(job_id: str) -> MixResponse:
    state = _get_mix_state(job_id)
    if state is not None:
        return state
    output_file = _latest_output_file(job_id)
    if output_file is not None:
        output_name = output_file.name
        output_url = f"/assets/{job_id}/output"
        if output_name != "output.wav":
            output_url = f"{output_url}?name={output_name}"
        return MixResponse(
            job_id=job_id,
            status=JobStatus.DONE,
            output_url=output_url,
        )
    raise HTTPException(status_code=404, detail="mix not started")


@router.post("/{job_id}/mix/cancel", response_model=MixResponse)
def cancel_mix(job_id: str) -> MixResponse:
    state = _get_mix_state(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="mix not started")
    if state.status != JobStatus.RUNNING:
        return state
    job = _jobs.get(job_id)
    if job is not None:
        _set_job(
            job.copy(
                update={"status": JobStatus.CANCELLED, "updated_at": datetime.utcnow()}
            )
        )
    return _set_mix_state(
        job_id,
        JobStatus.CANCELLED,
        detail="cancelled",
        progress=state.progress,
        chunks_done=state.chunks_done,
        chunks_total=state.chunks_total,
        eta_seconds=state.eta_seconds,
    )


@router.post("/{job_id}/mix", response_model=MixResponse)
def mix_job(job_id: str, payload: MixRequest) -> MixResponse:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "JOB_NOT_FOUND", "detail": "job not found"},
        )
    file_paths = _job_files.get(job_id)
    if file_paths is None or not file_paths["wav"].exists():
        raise HTTPException(
            status_code=404,
            detail={"error_code": "INPUT_NOT_FOUND", "detail": "input audio not found"},
        )
    if not payload.prompts:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "PROMPTS_REQUIRED", "detail": "prompts required"},
        )
    if len(payload.prompts) != len(payload.gains):
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "PROMPT_GAIN_MISMATCH",
                "detail": "prompts and gains must match length",
            },
        )

    preview_seconds = None
    preview_start = 0.0
    if payload.preview:
        preview_seconds = (
            payload.preview_seconds
            if payload.preview_seconds is not None
            else settings.preview_seconds
        )
        if payload.preview_start is not None:
            preview_start = payload.preview_start

    existing = _get_mix_state(job_id)
    if existing is not None and existing.status == JobStatus.RUNNING and not payload.force:
        return existing

    mix_token = uuid.uuid4().hex
    output_filename = f"output-{mix_token}.wav"
    output_path = _output_root / job_id / output_filename

    running = job.copy(update={"status": JobStatus.RUNNING, "updated_at": datetime.utcnow()})
    _set_job(running)
    _set_mix_state(job_id, JobStatus.RUNNING, token=mix_token, progress=0.0)

    def _run_mix() -> None:
        chunk_seconds, chunk_overlap = tasks._resolve_chunk_settings(preview_seconds)
        logger.info(
            (
                "Mix start job=%s kind=%s prompts=%d mode=%s preview_seconds=%s "
                "preview_start=%s chunk=%ss overlap=%ss"
            ),
            job_id,
            "preview" if preview_seconds else "full",
            len(payload.prompts),
            payload.mode,
            preview_seconds,
            preview_start,
            chunk_seconds,
            chunk_overlap,
        )
        start_time = time.time()
        last_progress = 0.0

        def _progress(done: int, total: int) -> None:
            nonlocal last_progress
            if total <= 0:
                return
            if not _should_finalize(job_id, mix_token):
                return
            now = time.time()
            if done < total and now - last_progress < 0.5:
                return
            elapsed = now - start_time
            eta = (elapsed / done * (total - done)) if done > 0 else None
            _update_mix_progress(job_id, done, total, eta, token=mix_token)
            last_progress = now

        def _should_cancel() -> bool:
            state = _get_mix_state(job_id)
            if state is None:
                return True
            if state.status == JobStatus.CANCELLED:
                return True
            return _get_mix_token(job_id) != mix_token

        try:
            tasks.process_job(
                file_paths["wav"],
                output_path,
                prompts=payload.prompts,
                gains=payload.gains,
                mode=payload.mode,
                target_sr=DEFAULT_SAMPLE_RATE,
                preview_seconds=preview_seconds,
                preview_start=preview_start,
                cache_dir=_cache_root,
                progress_callback=_progress,
                should_cancel=_should_cancel,
                job_id=job_id,
            )
            if not _should_finalize(job_id, mix_token):
                return
            mix_kind = "preview" if preview_seconds else "full"
            mix_summary = JobMixSummary(
                kind=mix_kind,
                output_name=output_filename,
                preview_seconds=preview_seconds if mix_kind == "preview" else None,
                preview_start=preview_start if mix_kind == "preview" else None,
                updated_at=datetime.utcnow(),
            )
            done = _append_mix_history(
                running.copy(
                    update={"status": JobStatus.DONE, "updated_at": datetime.utcnow()}
                ),
                mix_summary,
            )
            _set_job(done)
            state = _get_mix_state(job_id)
            elapsed = time.time() - start_time
            logger.info("Mix done job=%s seconds=%.1f output=%s", job_id, elapsed, output_filename)
            _set_mix_state(
                job_id,
                JobStatus.DONE,
                output_url=f"/assets/{job_id}/output?name={output_filename}",
                token=mix_token,
                progress=1.0,
                chunks_done=state.chunks_done if state else None,
                chunks_total=state.chunks_total if state else None,
                eta_seconds=0.0 if state and state.chunks_total else None,
            )
        except tasks.CancelledError:
            state = _get_mix_state(job_id)
            if state is None or state.status == JobStatus.CANCELLED:
                return
            elapsed = time.time() - start_time
            logger.info("Mix cancelled job=%s seconds=%.1f", job_id, elapsed)
            _set_job(
                running.copy(
                    update={"status": JobStatus.CANCELLED, "updated_at": datetime.utcnow()}
                )
            )
            _set_mix_state(
                job_id,
                JobStatus.CANCELLED,
                detail="cancelled",
                token=mix_token,
                progress=state.progress,
                chunks_done=state.chunks_done,
                chunks_total=state.chunks_total,
                eta_seconds=state.eta_seconds,
            )
        except Exception as exc:
            if not _should_finalize(job_id, mix_token):
                return
            elapsed = time.time() - start_time
            code, detail = classify_error(exc)
            logger.warning(
                "Mix failed job=%s seconds=%.1f error_code=%s error=%s",
                job_id,
                elapsed,
                code,
                exc,
            )
            failed = running.copy(
                update={
                    "status": JobStatus.FAILED,
                    "updated_at": datetime.utcnow(),
                    "detail": detail,
                    "error_code": code,
                }
            )
            _set_job(failed)
            _set_mix_state(
                job_id,
                JobStatus.FAILED,
                detail=failed.detail,
                error_code=code,
                token=mix_token,
            )

    threading.Thread(target=_run_mix, name=f"mix-{job_id}", daemon=True).start()
    return _get_mix_state(job_id) or MixResponse(job_id=job_id, status=JobStatus.RUNNING)


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.get("/", response_model=list[Job])
@router.get("", response_model=list[Job], include_in_schema=False)
def list_jobs() -> list[Job]:
    with _jobs_lock:
        jobs = list(_jobs.values())
    return sorted(jobs, key=lambda job: job.created_at, reverse=True)


@router.post("/cleanup")
def cleanup_jobs(payload: CleanupRequest) -> dict[str, object]:
    removed_jobs: list[str] = []
    cleared_outputs = 0
    cleared_cache = False
    keep_latest = payload.keep_latest

    if keep_latest is not None:
        keep_latest = max(0, keep_latest)
        with _jobs_lock:
            jobs = list(_jobs.values())
        jobs_sorted = sorted(jobs, key=lambda job: job.created_at, reverse=True)
        for job in jobs_sorted[keep_latest:]:
            removed_jobs.append(job.id)
            with _jobs_lock:
                _jobs.pop(job.id, None)
            job_path = _job_store_root / f"{job.id}.json"
            if job_path.exists():
                job_path.unlink()
            _job_files.pop(job.id, None)
            _purge_job_files(job.id)
            with _mix_lock:
                _mix_states.pop(job.id, None)
                _mix_tokens.pop(job.id, None)

    if payload.clear_outputs:
        with _jobs_lock:
            jobs = list(_jobs.values())
        for job in jobs:
            if _purge_output_dir(job.id):
                cleared_outputs += 1
            if job.last_mix or job.mix_history:
                updated = job.copy(update={"last_mix": None, "mix_history": []})
                _set_job(updated)

    if payload.clear_cache:
        if _cache_root.exists():
            shutil.rmtree(_cache_root, ignore_errors=True)
        _cache_root.mkdir(parents=True, exist_ok=True)
        cleared_cache = True

    with _jobs_lock:
        remaining_jobs = len(_jobs)
    return {
        "removed_jobs": removed_jobs,
        "remaining_jobs": remaining_jobs,
        "cleared_outputs": cleared_outputs,
        "cleared_cache": cleared_cache,
    }


@router.delete("/{job_id}")
def delete_job(job_id: str) -> dict[str, str]:
    with _jobs_lock:
        job = _jobs.pop(job_id, None)
    job_path = _job_store_root / f"{job_id}.json"
    if job is None and not job_path.exists():
        raise HTTPException(status_code=404, detail="job not found")
    if job_path.exists():
        job_path.unlink()
    _job_files.pop(job_id, None)
    _purge_job_files(job_id)
    with _mix_lock:
        _mix_states.pop(job_id, None)
        _mix_tokens.pop(job_id, None)
    return {"id": job_id, "status": "deleted"}


_load_jobs_from_disk()
