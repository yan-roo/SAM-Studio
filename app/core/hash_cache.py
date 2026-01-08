from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def hash_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fingerprint_settings(settings: dict[str, Any]) -> str:
    payload = json.dumps(settings, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def cache_key(audio_hash: str, settings_hash: str) -> str:
    return f"{audio_hash}:{settings_hash}"


def cache_path(
    cache_dir: str | Path, audio_hash: str, settings_hash: str, suffix: str = ".wav"
) -> Path:
    base = Path(cache_dir) / audio_hash
    return base / f"{settings_hash}{suffix}"
