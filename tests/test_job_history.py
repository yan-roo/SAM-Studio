from datetime import datetime
from pathlib import Path

import pytest

from app.api import routes_jobs
from app.api.schemas import CleanupRequest, Job, JobMixSummary, JobStatus


def _reset_state():
    routes_jobs._jobs.clear()
    routes_jobs._job_files.clear()
    routes_jobs._mix_states.clear()
    routes_jobs._mix_tokens.clear()


def test_job_history_persists_and_loads(tmp_path: Path):
    store_root = tmp_path / "jobs"
    store_root.mkdir(parents=True, exist_ok=True)
    routes_jobs._job_store_root = store_root
    routes_jobs._job_store_root.mkdir(parents=True, exist_ok=True)
    _reset_state()

    job = Job(
        id="job-123",
        status=JobStatus.DONE,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        candidates=[],
        last_mix=JobMixSummary(
            kind="preview",
            output_name="output-test.wav",
            preview_seconds=10.0,
            preview_start=0.0,
            updated_at=datetime.utcnow(),
        ),
        mix_history=[
            JobMixSummary(
                kind="preview",
                output_name="output-test.wav",
                preview_seconds=10.0,
                preview_start=0.0,
                updated_at=datetime.utcnow(),
            )
        ],
    )
    routes_jobs._set_job(job)
    assert (store_root / "job-123.json").exists()

    _reset_state()
    routes_jobs._load_jobs_from_disk()
    loaded = routes_jobs._jobs.get("job-123")
    assert loaded is not None
    assert loaded.last_mix is not None
    assert loaded.last_mix.output_name == "output-test.wav"
    assert loaded.mix_history is not None
    assert loaded.mix_history[0].kind == "preview"


def test_delete_job_removes_record_and_files(tmp_path: Path):
    store_root = tmp_path / "jobs"
    upload_root = tmp_path / "uploads"
    output_root = tmp_path / "outputs"
    store_root.mkdir(parents=True, exist_ok=True)
    upload_root.mkdir(parents=True, exist_ok=True)
    output_root.mkdir(parents=True, exist_ok=True)
    routes_jobs._job_store_root = store_root
    routes_jobs._upload_root = upload_root
    routes_jobs._output_root = output_root
    _reset_state()

    job_id = "job-456"
    upload_dir = upload_root / job_id
    output_dir = output_root / job_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    (upload_dir / "input.wav").write_text("fake")
    (output_dir / "output.wav").write_text("fake")

    job = Job(
        id=job_id,
        status=JobStatus.DONE,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        candidates=[],
    )
    routes_jobs._set_job(job)

    response = routes_jobs.delete_job(job_id)
    assert response["id"] == job_id
    assert not (store_root / f"{job_id}.json").exists()
    assert not upload_dir.exists()
    assert not output_dir.exists()
    assert job_id not in routes_jobs._jobs


def test_cleanup_removes_old_jobs_and_outputs(tmp_path: Path):
    store_root = tmp_path / "jobs"
    upload_root = tmp_path / "uploads"
    output_root = tmp_path / "outputs"
    cache_root = tmp_path / "cache"
    store_root.mkdir(parents=True, exist_ok=True)
    upload_root.mkdir(parents=True, exist_ok=True)
    output_root.mkdir(parents=True, exist_ok=True)
    cache_root.mkdir(parents=True, exist_ok=True)
    routes_jobs._job_store_root = store_root
    routes_jobs._upload_root = upload_root
    routes_jobs._output_root = output_root
    routes_jobs._cache_root = cache_root
    _reset_state()

    for idx in range(3):
        job_id = f"job-{idx}"
        upload_dir = upload_root / job_id
        output_dir = output_root / job_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)
        (upload_dir / "input.wav").write_text("fake")
        (output_dir / "output.wav").write_text("fake")
        job = Job(
            id=job_id,
            status=JobStatus.DONE,
            created_at=datetime(2024, 1, idx + 1),
            updated_at=datetime(2024, 1, idx + 1),
            candidates=[],
        )
        routes_jobs._set_job(job)

    response = routes_jobs.cleanup_jobs(
        CleanupRequest(keep_latest=1, clear_outputs=True, clear_cache=True)
    )
    assert response["removed_jobs"]
    assert response["remaining_jobs"] == 1
    assert response["cleared_cache"] is True
    remaining = list(routes_jobs._jobs.keys())
    assert len(remaining) == 1
