from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class DeviceResult:
    name: str
    path: Path


def _default_devices() -> list[DeviceResult]:
    return [
        DeviceResult("mps", Path("data/benchmarks/benchmark-results-mps.json")),
        DeviceResult("cpu", Path("data/benchmarks/benchmark-results-cpu.json")),
    ]


def _parse_device_arg(raw: str) -> DeviceResult:
    if "=" not in raw:
        raise argparse.ArgumentTypeError(
            "--device must look like name=path/to/results.json"
        )
    name, path = raw.split("=", 1)
    name = name.strip()
    if not name:
        raise argparse.ArgumentTypeError("device name cannot be empty")
    return DeviceResult(name=name, path=Path(path))


def _extract_results(data: object) -> tuple[list[dict], dict | None]:
    # New format: {"meta": {...}, "results": [...]}
    if isinstance(data, dict):
        results = data.get("results")
        meta = data.get("meta") if isinstance(data.get("meta"), dict) else None
        if isinstance(results, list):
            return results, meta
        raise ValueError("results JSON object must contain a list field named 'results'")

    # Legacy format: [...]
    if isinstance(data, list):
        return data, None

    raise ValueError("results JSON must be either a list or an object with a 'results' list")


def _load_results(path: Path) -> tuple[dict[str, dict], dict | None]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows, meta = _extract_results(data)
    return {row["case_id"]: row for row in rows}, meta


def _ordered_case_ids(case_ids: Iterable[str]) -> list[str]:
    preferred = ["speech", "whistle", "music", "mix_speech_music"]
    case_set = set(case_ids)
    ordered: list[str] = [case for case in preferred if case in case_set]
    ordered.extend(sorted(case_set - set(ordered)))
    return ordered


def _fmt(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "-"
    return f"{value:.{digits}f}"


def _build_table(devices: list[DeviceResult], by_device: dict[str, dict[str, dict]]) -> str:
    header_cols = ["case", "prompts"]
    for device in devices:
        header_cols.append(f"{device.name}_mean_s")
        header_cols.append(f"{device.name}_p95_s")
    if len(devices) >= 2:
        header_cols.append(f"{devices[1].name}/{devices[0].name}")

    header = "| " + " | ".join(header_cols) + " |"
    sep = "| " + " | ".join(["---", "---", *(["---:"] * (len(header_cols) - 2))]) + " |"

    all_case_ids = set()
    for rows in by_device.values():
        all_case_ids.update(rows.keys())
    case_ids = _ordered_case_ids(all_case_ids)

    lines: list[str] = [header, sep]
    for case_id in case_ids:
        prompts = None
        row_cells = [case_id]
        for device in devices:
            row = by_device[device.name].get(case_id)
            if row and prompts is None:
                prompts = row.get("prompts")
        row_cells.append(prompts or "-")

        means: list[float | None] = []
        for device in devices:
            row = by_device[device.name].get(case_id)
            mean = row.get("elapsed_seconds_mean") if row else None
            p95 = row.get("elapsed_seconds_p95") if row else None
            means.append(mean)
            row_cells.append(_fmt(mean))
            row_cells.append(_fmt(p95))

        if len(devices) >= 2:
            base = means[0]
            other = means[1]
            if base and other and base > 0:
                ratio = other / base
            else:
                ratio = None
            row_cells.append(_fmt(ratio, digits=2))

        lines.append("| " + " | ".join(row_cells) + " |")

    return "\n".join(lines)


def _meta_summary(name: str, meta: dict | None) -> str | None:
    if not meta:
        return None
    device_env = meta.get("sam_audio_device_env")
    system = meta.get("system")
    release = meta.get("release")
    machine = meta.get("machine")
    python_version = meta.get("python_version")
    memory_gb = meta.get("memory_gb")
    parts = [
        f"device_env={device_env}",
        f"{system} {release} ({machine})",
        f"python={python_version}",
        f"memory_gb={memory_gb}",
    ]
    return f"- {name}: " + " | ".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare benchmark JSON results across devices and print a Markdown table."
    )
    parser.add_argument(
        "--device",
        action="append",
        type=_parse_device_arg,
        help="Device results to compare, e.g. --device mps=path.json --device cpu=path.json",
    )
    args = parser.parse_args()

    devices = args.device if args.device else _default_devices()

    by_device: dict[str, dict[str, dict]] = {}
    meta_by_device: dict[str, dict | None] = {}
    missing: list[str] = []
    for device in devices:
        if not device.path.exists():
            missing.append(f"{device.name}: {device.path}")
            by_device[device.name] = {}
            meta_by_device[device.name] = None
            continue
        rows, meta = _load_results(device.path)
        by_device[device.name] = rows
        meta_by_device[device.name] = meta

    if missing:
        print("Missing result files:")
        for item in missing:
            print(f"- {item}")
        print()

    meta_lines: list[str] = []
    for device in devices:
        line = _meta_summary(device.name, meta_by_device.get(device.name))
        if line:
            meta_lines.append(line)
    if meta_lines:
        print("Environment summary")
        for line in meta_lines:
            print(line)
        print()

    print("Device comparison")
    print(_build_table(devices, by_device))


if __name__ == "__main__":
    main()
