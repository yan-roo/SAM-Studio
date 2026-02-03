from app.core.errors import classify_error


def test_classify_error_mappings():
    code, detail = classify_error(RuntimeError("ffmpeg not found; install it"))
    assert code == "FFMPEG_MISSING"
    assert "ffmpeg" in detail.lower()

    code, _ = classify_error(
        RuntimeError("soundfile is required for audio I/O; install dependencies to use this feature.")
    )
    assert code == "SOUNDFILE_MISSING"

    code, _ = classify_error(
        RuntimeError(
            "SAM-Audio is not installed. Install from https://github.com/facebookresearch/sam-audio"
        )
    )
    assert code == "SAM_AUDIO_MISSING"

    code, _ = classify_error(RuntimeError("CUDA out of memory"))
    assert code == "DEVICE_OOM"

    code, _ = classify_error(
        RuntimeError("expected input[2, 1, 1440002] to have 32 channels, but got 1 channels instead")
    )
    assert code == "SHAPE_MISMATCH"

    code, _ = classify_error(RuntimeError("some unexpected error"))
    assert code == "UNKNOWN_ERROR"
