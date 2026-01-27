from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]


def _row(case_id: str, prompts: str, mean: float, p95: float) -> dict:
    return {
        "case_id": case_id,
        "prompts": prompts,
        "elapsed_seconds_mean": mean,
        "elapsed_seconds_p95": p95,
    }


def test_benchmark_compare_supports_meta_and_legacy_formats(tmp_path: Path) -> None:
    # New format: { meta, results }
    mps_path = tmp_path / "mps.json"
    mps_payload = {
        "meta": {
            "sam_audio_device_env": "mps",
            "system": "Darwin",
            "release": "25.0.0",
            "machine": "arm64",
            "python_version": "3.11.0",
            "memory_gb": 16,
        },
        "results": [
            _row("speech", "speech", 10.0, 12.0),
            _row("music", "music", 20.0, 22.0),
        ],
    }
    mps_path.write_text(json.dumps(mps_payload), encoding="utf-8")

    # Legacy format: [ ... ]
    cpu_path = tmp_path / "cpu.json"
    cpu_payload = [
        _row("speech", "speech", 15.0, 16.0),
        _row("music", "music", 25.0, 26.0),
    ]
    cpu_path.write_text(json.dumps(cpu_payload), encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            "scripts/benchmark_compare.py",
            "--device",
            f"mps={mps_path}",
            "--device",
            f"cpu={cpu_path}",
        ],
        cwd=ROOT_DIR,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Environment summary" in result.stdout
    assert "Device comparison" in result.stdout
    assert "speech" in result.stdout
    assert "music" in result.stdout

