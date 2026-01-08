import pytest


@pytest.fixture(autouse=True)
def _force_stub_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SAM_AUDIO_BACKEND", "stub")
