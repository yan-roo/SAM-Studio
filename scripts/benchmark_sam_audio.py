from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core.audio_io import read_audio  # noqa: E402
from app.core.config import DEFAULT_SAMPLE_RATE  # noqa: E402
from app.worker import tasks  # noqa: E402


@dataclass(frozen=True)
class BenchmarkCase:
    case_id: str
    filename: str
    prompts: tuple[str, ...]
    mode: str = "keep"


DEFAULT_CASES: tuple[BenchmarkCase, ...] = (
    BenchmarkCase(
        case_id="speech",
        filename="speech_voices_20s_16k.wav",
        prompts=("speech",),
    ),
    BenchmarkCase(
        case_id="whistle",
        filename="whistle_train_20s_16k.wav",
        prompts=("whistle",),
    ),
    BenchmarkCase(
        case_id="music",
        filename="music_sample2_20s_16k.wav",
        prompts=("music",),
    ),
    BenchmarkCase(
        case_id="mix_speech_music",
        filename="mix_speech_plus_music_20s_16k.wav",
        prompts=("speech", "music"),
    ),
)


def _format_prompts(prompts: Iterable[str]) -> str:
    return ", ".join(prompts)


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    if q <= 0.0:
        return min(values)
    if q >= 1.0:
        return max(values)
    ordered = sorted(values)
    pos = (len(ordered) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(ordered) - 1)
    if lo == hi:
        return ordered[lo]
    frac = pos - lo
    return ordered[lo] * (1.0 - frac) + ordered[hi] * frac


def _summarize_runs(elapsed_runs: list[float]) -> dict[str, float]:
    if not elapsed_runs:
        return {
            "mean": 0.0,
            "p50": 0.0,
            "p95": 0.0,
            "min": 0.0,
            "max": 0.0,
        }
    mean = sum(elapsed_runs) / float(len(elapsed_runs))
    return {
        "mean": mean,
        "p50": _percentile(elapsed_runs, 0.5),
        "p95": _percentile(elapsed_runs, 0.95),
        "min": min(elapsed_runs),
        "max": max(elapsed_runs),
    }


def _markdown_table(rows: list[dict]) -> str:
    header = (
        "| case | file | prompts | preview_s | runs | mean_s | p95_s | "
        "rtf_mean | x_realtime_mean | status |"
    )
    sep = "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
    body_lines: list[str] = []
    for row in rows:
        body_lines.append(
            "| {case_id} | {filename} | {prompts} | {preview_seconds:.1f} | {runs} | "
            "{elapsed_seconds_mean:.1f} | {elapsed_seconds_p95:.1f} | {rtf_mean:.2f} | "
            "{x_realtime_mean:.2f} | {status} |".format(**row)
        )
    return "\n".join([header, sep, *body_lines])


def _safe_sysctl(name: str) -> str | None:
    try:
        result = subprocess.run(
            ["sysctl", "-n", name],
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception:
        return None
    value = result.stdout.strip()
    return value or None


def _detect_memory_bytes() -> int | None:
    # Prefer macOS sysctl when available.
    memsize = _safe_sysctl("hw.memsize")
    if memsize:
        try:
            return int(memsize)
        except ValueError:
            pass

    # Portable-ish fallback for many Unix systems.
    try:
        page_size = os.sysconf("SC_PAGE_SIZE")
        phys_pages = os.sysconf("SC_PHYS_PAGES")
        if isinstance(page_size, int) and isinstance(phys_pages, int):
            return page_size * phys_pages
    except Exception:
        return None
    return None


def _detect_torch_info() -> dict[str, Any]:
    try:
        import torch
    except Exception as exc:  # pragma: no cover - optional dependency surface
        return {"available": False, "error": str(exc)}

    cuda_available = torch.cuda.is_available()
    cuda_device_count = torch.cuda.device_count() if cuda_available else 0
    cuda_version = getattr(torch.version, "cuda", None)
    mps_backend = getattr(torch.backends, "mps", None)
    mps_available = bool(mps_backend and mps_backend.is_available())

    return {
        "available": True,
        "version": getattr(torch, "__version__", "unknown"),
        "cuda_available": cuda_available,
        "cuda_version": cuda_version,
        "cuda_device_count": cuda_device_count,
        "mps_available": mps_available,
    }


def _collect_benchmark_meta(preview_seconds: float, warmup: int, repeats: int) -> dict[str, Any]:
    mem_bytes = _detect_memory_bytes()
    mem_gb = (mem_bytes / float(1024**3)) if mem_bytes else None

    cpu_brand = _safe_sysctl("machdep.cpu.brand_string")
    logical_cores = _safe_sysctl("hw.logicalcpu")
    physical_cores = _safe_sysctl("hw.physicalcpu")
    logical_core_count = (
        int(logical_cores)
        if logical_cores and logical_cores.isdigit()
        else os.cpu_count()
    )
    physical_core_count = (
        int(physical_cores)
        if physical_cores and physical_cores.isdigit()
        else None
    )

    meta: dict[str, Any] = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "sam_audio_device_env": os.getenv("SAM_AUDIO_DEVICE", "auto"),
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "cpu_brand": cpu_brand,
        "cpu_logical_cores": logical_core_count,
        "cpu_physical_cores": physical_core_count,
        "memory_gb": round(mem_gb, 2) if mem_gb else None,
        "torch": _detect_torch_info(),
        "settings": {
            "preview_seconds": preview_seconds,
            "warmup": warmup,
            "repeats": repeats,
        },
    }
    return meta


def run_benchmark(
    assets_dir: Path,
    output_dir: Path,
    preview_seconds: float,
    preview_start: float,
    limit: int | None,
    repeats: int,
    warmup: int,
) -> list[dict]:
    cases = list(DEFAULT_CASES)
    if limit is not None:
        cases = cases[: max(0, limit)]

    output_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []

    for case in cases:
        input_path = assets_dir / case.filename
        case_out_dir = output_dir / case.case_id
        case_out_dir.mkdir(parents=True, exist_ok=True)
        output_path = case_out_dir / "output.wav"

        if not input_path.exists():
            results.append(
                {
                    "case_id": case.case_id,
                    "filename": case.filename,
                    "prompts": _format_prompts(case.prompts),
                    "preview_seconds": preview_seconds,
                    "runs": 0,
                    "elapsed_seconds_runs": [],
                    "elapsed_seconds_mean": 0.0,
                    "elapsed_seconds_p50": 0.0,
                    "elapsed_seconds_p95": 0.0,
                    "elapsed_seconds_min": 0.0,
                    "elapsed_seconds_max": 0.0,
                    "rtf_mean": 0.0,
                    "x_realtime_mean": 0.0,
                    "status": "missing_input",
                    "error": f"missing file: {input_path}",
                    "errors": [f"missing file: {input_path}"],
                    "output_path": str(output_path),
                }
            )
            continue

        audio, sr = read_audio(input_path, target_sr=None, mono=True)
        duration_seconds = audio.shape[0] / float(sr)
        effective_preview_seconds = min(duration_seconds, preview_seconds)
        gains = [1.0] * len(case.prompts)

        elapsed_runs: list[float] = []
        errors: list[str] = []

        total_runs = max(0, warmup) + max(1, repeats)
        for run_idx in range(total_runs):
            start_time = time.perf_counter()
            try:
                tasks.process_job(
                    input_path=input_path,
                    output_path=output_path,
                    prompts=list(case.prompts),
                    gains=gains,
                    mode=case.mode,
                    target_sr=DEFAULT_SAMPLE_RATE,
                    preview_seconds=effective_preview_seconds,
                    preview_start=preview_start,
                    cache_dir=None,
                )
            except Exception as exc:  # pragma: no cover - best effort reporting
                errors.append(str(exc))
            elapsed_seconds = time.perf_counter() - start_time
            if run_idx >= warmup:
                elapsed_runs.append(elapsed_seconds)

        summary = _summarize_runs(elapsed_runs)
        mean_elapsed = summary["mean"]
        if effective_preview_seconds > 0 and mean_elapsed > 0:
            rtf_mean = mean_elapsed / effective_preview_seconds
            x_realtime_mean = effective_preview_seconds / mean_elapsed
        else:
            rtf_mean = 0.0
            x_realtime_mean = 0.0

        results.append(
            {
                "case_id": case.case_id,
                "filename": case.filename,
                "prompts": _format_prompts(case.prompts),
                "preview_seconds": effective_preview_seconds,
                "runs": len(elapsed_runs),
                "elapsed_seconds_runs": elapsed_runs,
                "elapsed_seconds_mean": mean_elapsed,
                "elapsed_seconds_p50": summary["p50"],
                "elapsed_seconds_p95": summary["p95"],
                "elapsed_seconds_min": summary["min"],
                "elapsed_seconds_max": summary["max"],
                "rtf_mean": rtf_mean,
                "x_realtime_mean": x_realtime_mean,
                "status": "error" if errors else "ok",
                "error": errors[0] if errors else None,
                "errors": errors,
                "output_path": str(output_path),
            }
        )

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run a small SAM-Audio benchmark over local benchmark assets."
    )
    parser.add_argument(
        "--assets-dir",
        type=Path,
        default=Path("data/benchmarks/assets"),
        help="Directory containing benchmark assets.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/benchmarks/outputs"),
        help="Directory to write benchmark outputs.",
    )
    parser.add_argument(
        "--preview-seconds",
        type=float,
        default=20.0,
        help="Preview seconds to process per asset (default: 20).",
    )
    parser.add_argument(
        "--preview-start",
        type=float,
        default=0.0,
        help="Preview start time in seconds (default: 0).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only run the first N cases (for quick checks).",
    )
    parser.add_argument(
        "--repeats",
        type=int,
        default=3,
        help="Number of measured runs per case (default: 3).",
    )
    parser.add_argument(
        "--warmup",
        type=int,
        default=1,
        help="Number of warmup runs per case (default: 1).",
    )
    parser.add_argument(
        "--json-out",
        type=Path,
        default=Path("data/benchmarks/benchmark-results.json"),
        help="Where to write JSON results.",
    )

    args = parser.parse_args()
    repeats = max(1, args.repeats)
    warmup = max(0, args.warmup)
    preview_seconds = max(0.0, args.preview_seconds)
    preview_start = max(0.0, args.preview_start)

    results = run_benchmark(
        assets_dir=args.assets_dir,
        output_dir=args.output_dir,
        preview_seconds=preview_seconds,
        preview_start=preview_start,
        limit=args.limit,
        repeats=repeats,
        warmup=warmup,
    )

    meta = _collect_benchmark_meta(
        preview_seconds=preview_seconds,
        warmup=warmup,
        repeats=repeats,
    )

    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"meta": meta, "results": results}
    args.json_out.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print()
    print("Benchmark results")
    print(_markdown_table(results))
    print()
    print(
        f"Settings: preview_seconds={preview_seconds:.1f}, warmup={warmup}, repeats={repeats}"
    )
    print(
        "Environment: "
        f"device_env={meta.get('sam_audio_device_env')} | "
        f"{meta.get('system')} {meta.get('release')} ({meta.get('machine')}) | "
        f"python={meta.get('python_version')} | "
        f"memory_gb={meta.get('memory_gb')}"
    )
    print()
    print(f"JSON written to: {args.json_out}")


if __name__ == "__main__":
    main()
